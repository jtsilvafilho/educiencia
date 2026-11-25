-- Dados SÓ para o Supabase local (supabase db reset). Não rodar em produção.
-- Admin local de teste: admin@local.test / senha-local-123

update public.config
set titulo = 'Física 2º ano', professor = 'Prof. Silva',
    descricao = 'Conteúdos complementares das aulas.', modo = 'disponivel'
where id = 1;

insert into public.aulas (id, ordem, titulo, descricao, duracao, disponivel) values
  ('00000000-0000-0000-0000-0000000000a1', 1, 'Cinemática: movimento e velocidade',
   'Revisão de posição, deslocamento e velocidade média, com exemplos do dia a dia.', '12 min', true),
  ('00000000-0000-0000-0000-0000000000a2', 2, 'Leis de Newton',
   'As três leis de Newton e como identificar forças em situações reais.', '18 min', true),
  ('00000000-0000-0000-0000-0000000000a3', 3, 'Trabalho e energia',
   'Conceito de trabalho de uma força, energia cinética e potencial.', '15 min', false);

insert into public.cards (id, aula_id, ordem, titulo, descricao) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 0,
   'Conteúdo da aula', 'Vídeo, leitura e links da aula.'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 1,
   'Teste rápido', 'Duas perguntas para revisar.'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a2', 0,
   'Resumo', 'Leitura curta sobre as três leis.'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a3', 0,
   'Rascunho', 'Card de aula ainda indisponível.');

insert into public.blocos (card_id, ordem, tipo, subtitulo, conteudo) values
  ('00000000-0000-0000-0000-0000000000c1', 0, 'video', 'Vídeo da aula', '{"youtube_id":"M7lc1UVf-VE"}'),
  ('00000000-0000-0000-0000-0000000000c1', 1, 'texto', 'Para lembrar',
   '{"texto":"Velocidade média = deslocamento ÷ tempo.\nUnidade no SI: m/s.\n<b>Isto não vira HTML.</b>"}'),
  ('00000000-0000-0000-0000-0000000000c1', 2, 'link', 'Links úteis',
   '{"url":"https://phet.colorado.edu/pt_BR/","rotulo":"Simulador de movimento (PhET)"}'),
  ('00000000-0000-0000-0000-0000000000c1', 3, 'link', '',
   '{"url":"https://pt.wikipedia.org/wiki/Cinem%C3%A1tica","rotulo":"Artigo complementar"}'),
  ('00000000-0000-0000-0000-0000000000c1', 4, 'arquivo', 'Material para baixar',
   '{"storage_path":"00000000-0000-0000-0000-0000000000a1/exemplo.pdf","nome":"Lista de exercícios","tamanho_bytes":204800}'),
  ('00000000-0000-0000-0000-0000000000c2', 0, 'quiz', 'Pergunta 1',
   '{"pergunta":"Um carro anda 100 m em 10 s. Qual a velocidade média?","opcoes":["1 m/s","10 m/s","100 m/s"],"correta":1,"explicacao":"100 m ÷ 10 s = 10 m/s."}'),
  ('00000000-0000-0000-0000-0000000000c2', 1, 'quiz', 'Pergunta 2',
   '{"pergunta":"Qual a unidade de velocidade no SI?","opcoes":["km/h","m/s"],"correta":1}'),
  ('00000000-0000-0000-0000-0000000000c3', 0, 'texto', '',
   '{"texto":"1ª lei: inércia.\n2ª lei: F = m·a.\n3ª lei: ação e reação."}'),
  ('00000000-0000-0000-0000-0000000000c4', 0, 'texto', 'Em preparo', '{"texto":"Conteúdo ainda não liberado."}');

-- usuário admin local
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ad01',
  'authenticated', 'authenticated', 'admin@local.test', crypt('senha-local-123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
);
insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
values (
  gen_random_uuid(), '00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-00000000ad01',
  '{"sub":"00000000-0000-0000-0000-00000000ad01","email":"admin@local.test","email_verified":true}',
  'email', now(), now(), now()
);
insert into public.admins (user_id) values ('00000000-0000-0000-0000-00000000ad01');
