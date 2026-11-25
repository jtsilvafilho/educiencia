-- Testes de RLS. Rodar: npx supabase test db
begin;
select plan(18);

-- usuário comum (não admin)
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'aluno@local.test');

create or replace function pg_temp.como(papel text, uid uuid) returns void language plpgsql as $$
begin
  execute format('set local role %I', papel);
  perform set_config('request.jwt.claims',
    case when uid is null then '{}' else json_build_object('sub', uid, 'role', papel)::text end, true);
end $$;

-- ---------- anon, curso desligado ----------
update public.config set modo = 'indisponivel' where id = 1;
select pg_temp.como('anon', null);
select is((select count(*) from public.config)::int, 1, 'anon lê config');
select is((select count(*) from public.aulas)::int, 0, 'anon não lê aulas com curso desligado');
select is((select count(*) from public.blocos)::int, 0, 'anon não lê blocos com curso desligado');
reset role;

-- ---------- anon, curso ligado ----------
update public.config set modo = 'disponivel' where id = 1;
select pg_temp.como('anon', null);
select ok((select count(*) from public.aulas) > 0, 'anon lê aulas com curso ligado');
select ok((select count(*) from public.blocos) > 0, 'anon lê blocos com curso ligado');
select throws_ok($$ insert into public.aulas (titulo) values ('x') $$, '42501', null, 'anon não cria aula');
select throws_ok($$ update public.config set modo = 'indisponivel' $$, '42501', null, 'anon não altera config');
reset role;
select is((select modo from public.config), 'disponivel', 'config segue ligada após anon');

-- ---------- autenticado não admin ----------
select pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000000b1');
select is(public.is_admin(), false, 'aluno não é admin');
select throws_ok($$ insert into public.aulas (titulo) values ('x') $$, '42501', null, 'aluno não cria aula');
update public.aulas set titulo = 'hack';
delete from public.blocos;
update public.config set modo = 'indisponivel' where id = 1;
select is((select count(*) from public.admins)::int, 0, 'aluno não vê admins');
select throws_ok($$ insert into public.admins values ('00000000-0000-0000-0000-0000000000b1') $$, '42501', null, 'aluno não se torna admin');
reset role;
select is((select count(*) from public.aulas where titulo = 'hack')::int, 0, 'aluno não altera aulas');
select ok((select count(*) from public.blocos) > 0, 'aluno não exclui blocos');
select is((select modo from public.config), 'disponivel', 'aluno não altera config');

-- ---------- admin ----------
update public.config set modo = 'indisponivel' where id = 1;
select pg_temp.como('authenticated', '00000000-0000-0000-0000-00000000ad01');
select ok((select count(*) from public.aulas) > 0, 'admin lê aulas com curso desligado');
select lives_ok($$ insert into public.aulas (titulo, ordem) values ('Nova', 9) $$, 'admin cria aula');
update public.config set modo = 'disponivel' where id = 1;
reset role;
select is((select modo from public.config), 'disponivel', 'admin liga curso');

select * from finish();
rollback;
