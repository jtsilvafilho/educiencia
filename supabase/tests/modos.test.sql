-- Três modos do app, disponibilidade por aula, cards e blocos. Rodar: npx supabase test db
-- Depende do seed: a1/a2 disponíveis, a3 indisponível; cards c1..c4; 9 blocos (1 em c4).
begin;
select plan(49);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'aluno2@local.test');

create or replace function pg_temp.como(papel text, uid uuid) returns void language plpgsql as $$
begin
  execute format('set local role %I', papel);
  perform set_config('request.jwt.claims',
    case when uid is null then '{}' else json_build_object('sub', uid, 'role', papel)::text end, true);
end $$;

-- ================= modo disponivel =================
update public.config set modo = 'disponivel' where id = 1;

select pg_temp.como('anon', null);
select is((select count(*) from public.config)::int, 1, 'disponivel: anon lê config');
select is((select count(*) from public.aulas)::int, 3, 'disponivel: anon vê as 3 aulas (inclusive indisponível, só o card)');
select is((select count(*) from public.cards where aula_id = '00000000-0000-0000-0000-0000000000a1')::int, 2, 'disponivel: anon vê cards de aula disponível');
select is((select count(*) from public.cards where aula_id = '00000000-0000-0000-0000-0000000000a3')::int, 0, 'disponivel: anon não vê cards de aula indisponível');
select is((select count(*) from public.blocos where card_id = '00000000-0000-0000-0000-0000000000c4')::int, 0, 'disponivel: anon não vê blocos de aula indisponível');
select is((select count(*) from public.blocos)::int, 8, 'disponivel: anon vê só blocos liberados');
select is(public.aula_liberada('00000000-0000-0000-0000-0000000000a3'), false, 'aula_liberada falsa para aula indisponível');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.cards where aula_id = '00000000-0000-0000-0000-0000000000a3')::int, 0, 'disponivel: aluno não vê cards de aula indisponível');
select is((select count(*) from public.blocos)::int, 8, 'disponivel: aluno vê só blocos liberados');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-00000000ad01');
select is((select count(*) from public.cards where aula_id = '00000000-0000-0000-0000-0000000000a3')::int, 1, 'disponivel: admin vê prévia de aula indisponível');
select is((select count(*) from public.blocos where card_id = '00000000-0000-0000-0000-0000000000c4')::int, 1, 'disponivel: admin vê blocos da prévia');
reset role;

-- ================= modo teste =================
update public.config set modo = 'teste' where id = 1;

select pg_temp.como('anon', null);
select is((select modo from public.config), 'teste', 'teste: anon lê o modo');
select is((select count(*) from public.aulas)::int, 0, 'teste: anon não lê aulas');
select is((select count(*) from public.cards)::int, 0, 'teste: anon não lê cards');
select is((select count(*) from public.blocos)::int, 0, 'teste: anon não lê blocos');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.aulas)::int, 0, 'teste: aluno logado não lê aulas');
select is((select count(*) from public.cards)::int, 0, 'teste: aluno logado não lê cards');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-00000000ad01');
select is((select count(*) from public.aulas)::int, 3, 'teste: admin lê aulas');
select is((select count(*) from public.cards)::int, 4, 'teste: admin lê cards');
select is((select count(*) from public.blocos)::int, 9, 'teste: admin lê blocos');
reset role;

-- ================= modo indisponivel =================
update public.config set modo = 'indisponivel' where id = 1;

select pg_temp.como('anon', null);
select is((select count(*) from public.aulas)::int, 0, 'indisponivel: anon não lê aulas');
select is((select count(*) from public.cards)::int, 0, 'indisponivel: anon não lê cards');
select is((select count(*) from public.blocos)::int, 0, 'indisponivel: anon não lê blocos');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-00000000ad01');
select is((select count(*) from public.blocos)::int, 9, 'indisponivel: admin segue lendo para editar');
reset role;

-- ================= escrita =================
update public.config set modo = 'disponivel' where id = 1;

select pg_temp.como('anon', null);
select throws_ok($$ insert into public.cards (aula_id, titulo) values ('00000000-0000-0000-0000-0000000000a1', 'x') $$,
  '42501', null, 'anon não cria card');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'texto', '{"texto":"x"}') $$,
  '42501', null, 'anon não cria bloco');
reset role;

select pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ insert into public.cards (aula_id, titulo) values ('00000000-0000-0000-0000-0000000000a1', 'x') $$,
  '42501', null, 'aluno não cria card');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'texto', '{"texto":"x"}') $$,
  '42501', null, 'aluno não cria bloco');
update public.blocos set subtitulo = 'hack';
delete from public.cards;
update public.config set modo = 'teste' where id = 1;
reset role;
select is((select count(*) from public.blocos where subtitulo = 'hack')::int, 0, 'aluno não altera blocos');
select is((select count(*) from public.cards)::int, 4, 'aluno não exclui cards');
select is((select modo from public.config), 'disponivel', 'aluno não troca o modo');

select pg_temp.como('authenticated', '00000000-0000-0000-0000-00000000ad01');
select lives_ok($$ insert into public.cards (id, aula_id, titulo) values
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a2', 'Novo') $$, 'admin cria card');
select lives_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c9', 'quiz',
  '{"pergunta":"2+2?","opcoes":["3","4"],"correta":1,"explicacao":"Soma."}') $$, 'admin cria bloco quiz');
select lives_ok($$ update public.config set modo = 'teste' where id = 1 $$, 'admin troca o modo');
reset role;

-- ================= restrições =================
select throws_ok($$ update public.config set modo = 'outro' $$, '23514', null, 'modo inválido é recusado');
select is((select curso_disponivel from public.config), false, 'curso_disponivel derivada: falsa em teste');
select is(public.curso_disponivel(), false, 'curso_disponivel() falsa em teste');
select throws_ok($$ update public.config set curso_disponivel = true $$, '428C9', null, 'curso_disponivel não é gravável');

select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'link',
  '{"url":"javascript:alert(1)"}') $$, '23514', null, 'link javascript: recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'video',
  '{"youtube_id":"curto"}') $$, '23514', null, 'vídeo com id inválido recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'quiz',
  '{"pergunta":"p","opcoes":["a","b"],"correta":2}') $$, '23514', null, 'quiz com correta fora do intervalo recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'quiz',
  '{"pergunta":"p","opcoes":["a"],"correta":0}') $$, '23514', null, 'quiz com 1 opção recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'quiz',
  '{"pergunta":"p","opcoes":["a",{"x":1}],"correta":0}') $$, '23514', null, 'quiz com opção não texto recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'texto',
  '{"texto":""}') $$, '23514', null, 'texto vazio recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'html',
  '{"texto":"x"}') $$, '23514', null, 'tipo desconhecido recusado');
select throws_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'arquivo',
  '{"storage_path":"../x.pdf","nome":"x"}') $$, '23514', null, 'arquivo com caminho .. recusado');
select lives_ok($$ insert into public.blocos (card_id, tipo, conteudo) values ('00000000-0000-0000-0000-0000000000c1', 'link',
  '{"url":"https://exemplo.org/a","rotulo":"Ok"}') $$, 'link https aceito');

insert into public.aulas (id, titulo) values ('00000000-0000-0000-0000-0000000000a9', 'Aula nova');
select is((select disponivel from public.aulas where id = '00000000-0000-0000-0000-0000000000a9'), false, 'aula nova nasce indisponível');
update public.config set modo = 'disponivel' where id = 1;
select is((select curso_disponivel from public.config), true, 'curso_disponivel derivada: verdadeira em disponivel');

select * from finish();
rollback;
