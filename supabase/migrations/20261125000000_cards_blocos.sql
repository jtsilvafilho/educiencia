-- Cards, blocos, quiz, disponibilidade por aula e três modos do app.
-- Não apaga dados: aulas.youtube_id e recursos ficam como estão (só deixam de ser usados).

-- ---------- modo do app ----------

alter table public.config
  add column modo text not null default 'indisponivel'
  check (modo in ('disponivel', 'indisponivel', 'teste'));

update public.config
set modo = case when curso_disponivel then 'disponivel' else 'indisponivel' end;

-- Função passa a olhar o modo; policies de aulas/recursos herdam a regra.
create or replace function public.curso_disponivel()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select modo = 'disponivel' from public.config where id = 1), false);
$$;

-- Coluna antiga vira derivada do modo: apps antigos em cache seguem lendo; ninguém grava.
alter table public.config drop column curso_disponivel;
alter table public.config
  add column curso_disponivel boolean generated always as (modo = 'disponivel') stored;

-- ---------- disponibilidade por aula ----------

alter table public.aulas add column disponivel boolean not null default true;  -- existentes seguem visíveis
alter table public.aulas alter column disponivel set default false;           -- novas nascem indisponíveis

-- ---------- validação do conteúdo dos blocos ----------

create or replace function public.bloco_valido(p_tipo text, c jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int;
begin
  if c is null or jsonb_typeof(c) <> 'object' or octet_length(c::text) > 20000 then
    return false;
  end if;

  if p_tipo = 'texto' then
    return jsonb_typeof(c -> 'texto') = 'string'
       and char_length(c ->> 'texto') between 1 and 10000;

  elsif p_tipo = 'link' then
    return jsonb_typeof(c -> 'url') = 'string'
       and (c ->> 'url') ~ '^https?://[^[:space:]]'
       and char_length(c ->> 'url') <= 2000
       and (c -> 'rotulo' is null or (jsonb_typeof(c -> 'rotulo') = 'string' and char_length(c ->> 'rotulo') <= 200));

  elsif p_tipo = 'video' then
    return jsonb_typeof(c -> 'youtube_id') = 'string'
       and (c ->> 'youtube_id') ~ '^[A-Za-z0-9_-]{11}$';

  elsif p_tipo = 'arquivo' then
    return jsonb_typeof(c -> 'storage_path') = 'string'
       and char_length(c ->> 'storage_path') between 1 and 500
       and left(c ->> 'storage_path', 1) <> '/'
       and position('..' in (c ->> 'storage_path')) = 0
       and jsonb_typeof(c -> 'nome') = 'string'
       and char_length(c ->> 'nome') between 1 and 200
       and (c -> 'tamanho_bytes' is null or jsonb_typeof(c -> 'tamanho_bytes') = 'null'
            or (jsonb_typeof(c -> 'tamanho_bytes') = 'number' and (c ->> 'tamanho_bytes') ~ '^[0-9]+$'));

  elsif p_tipo = 'quiz' then
    if jsonb_typeof(c -> 'pergunta') <> 'string' or char_length(c ->> 'pergunta') not between 1 and 500
       or jsonb_typeof(c -> 'opcoes') <> 'array'
       or jsonb_typeof(c -> 'correta') <> 'number' or (c ->> 'correta') !~ '^[0-9]+$'
       or (c -> 'explicacao' is not null
           and (jsonb_typeof(c -> 'explicacao') <> 'string' or char_length(c ->> 'explicacao') > 1000)) then
      return false;
    end if;
    n := jsonb_array_length(c -> 'opcoes');
    if n not between 2 and 6 or (c ->> 'correta')::int >= n then
      return false;
    end if;
    return not exists (
      select 1 from jsonb_array_elements(c -> 'opcoes') e
      where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 1 and 300
    );
  end if;

  return false;
end;
$$;

-- ---------- tabelas ----------

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  aula_id uuid not null references public.aulas (id) on delete cascade,
  ordem int not null default 0,
  titulo text not null check (char_length(titulo) between 1 and 120),
  descricao text not null default '' check (char_length(descricao) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_aula_idx on public.cards (aula_id, ordem);

create table public.blocos (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  ordem int not null default 0,
  tipo text not null check (tipo in ('texto', 'link', 'video', 'arquivo', 'quiz')),
  subtitulo text not null default '' check (char_length(subtitulo) <= 200),
  conteudo jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bloco_conteudo_valido check (public.bloco_valido(tipo, conteudo))
);
create index blocos_card_idx on public.blocos (card_id, ordem);

create trigger cards_updated before update on public.cards
  for each row execute function public.tocar_updated_at();
create trigger blocos_updated before update on public.blocos
  for each row execute function public.tocar_updated_at();

-- ---------- regras de leitura ----------

-- Conteúdo da aula só sai com o app disponível E a aula disponível.
create or replace function public.aula_liberada(p_aula uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.curso_disponivel()
     and coalesce((select disponivel from public.aulas where id = p_aula), false);
$$;
revoke all on function public.aula_liberada(uuid) from public;
grant execute on function public.aula_liberada(uuid) to anon, authenticated;

create or replace function public.card_liberado(p_card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.aula_liberada((select aula_id from public.cards where id = p_card)), false);
$$;
revoke all on function public.card_liberado(uuid) from public;
grant execute on function public.card_liberado(uuid) to anon, authenticated;

alter table public.cards enable row level security;
alter table public.blocos enable row level security;

revoke all on public.cards, public.blocos from anon, authenticated;
grant select on public.cards, public.blocos to anon, authenticated;
grant insert, update, delete on public.cards, public.blocos to authenticated;

create policy cards_ler on public.cards for select to anon, authenticated
  using ((select public.is_admin()) or public.aula_liberada(aula_id));
create policy cards_inserir on public.cards for insert to authenticated
  with check ((select public.is_admin()));
create policy cards_alterar on public.cards for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy cards_excluir on public.cards for delete to authenticated
  using ((select public.is_admin()));

create policy blocos_ler on public.blocos for select to anon, authenticated
  using ((select public.is_admin()) or public.card_liberado(card_id));
create policy blocos_inserir on public.blocos for insert to authenticated
  with check ((select public.is_admin()));
create policy blocos_alterar on public.blocos for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy blocos_excluir on public.blocos for delete to authenticated
  using ((select public.is_admin()));

-- ---------- migração do conteúdo atual ----------
-- Cada aula com vídeo ou recursos ganha o card "Conteúdo da aula":
-- vídeo, depois arquivos, depois links, na ordem de hoje.

do $$
declare
  a record;
  r record;
  v_card uuid;
  v_ordem int;
  v_primeiro boolean;
begin
  for a in
    select au.id, au.youtube_id
    from public.aulas au
    where au.youtube_id is not null
       or exists (select 1 from public.recursos rc where rc.aula_id = au.id)
  loop
    insert into public.cards (aula_id, ordem, titulo, descricao)
    values (a.id, 0, 'Conteúdo da aula', '')
    returning id into v_card;
    v_ordem := 0;

    if a.youtube_id is not null then
      insert into public.blocos (card_id, ordem, tipo, subtitulo, conteudo)
      values (v_card, v_ordem, 'video', 'Vídeo da aula', jsonb_build_object('youtube_id', a.youtube_id));
      v_ordem := v_ordem + 1;
    end if;

    v_primeiro := true;
    for r in
      select * from public.recursos
      where aula_id = a.id and tipo = 'material' and storage_path is not null
      order by ordem, created_at
    loop
      insert into public.blocos (card_id, ordem, tipo, subtitulo, conteudo)
      values (v_card, v_ordem, 'arquivo',
              case when v_primeiro then 'Materiais para baixar' else '' end,
              jsonb_build_object('storage_path', r.storage_path, 'nome', left(r.titulo, 200),
                                 'tamanho_bytes', r.tamanho_bytes));
      v_ordem := v_ordem + 1;
      v_primeiro := false;
    end loop;

    v_primeiro := true;
    for r in
      select * from public.recursos
      where aula_id = a.id and tipo = 'link' and url is not null
      order by ordem, created_at
    loop
      insert into public.blocos (card_id, ordem, tipo, subtitulo, conteudo)
      values (v_card, v_ordem, 'link',
              case when v_primeiro then 'Links úteis' else '' end,
              jsonb_build_object('url', r.url, 'rotulo', left(r.titulo, 200)));
      v_ordem := v_ordem + 1;
      v_primeiro := false;
    end loop;
  end loop;
end;
$$;
