-- E-mail tolerante a espaço e caractere invisível.
--
-- Problema real: pessoa cadastrada e liberada em Configurações, digita o e-mail certo e recebe
-- "e-mail não liberado". O e-mail guardado em acessos.pessoas tinha um caractere que não se vê (espaço,
-- espaço sem quebra, marca de direção U+200E, espaço de largura zero...) — comum ao copiar o endereço do
-- Outlook/Teams. Todas as comparações eram exatas, então nunca batiam: nem a consulta do login, nem a
-- ligação da conta com a pessoa no primeiro acesso.
--
-- O que esta migração faz:
--   1. acessos.email_limpo(): minúsculo, sem espaços e sem caracteres invisíveis.
--   2. Limpa os e-mails já guardados em acessos.pessoas e liga contas existentes (auth.users) às pessoas
--      que estavam sem ligação, comparando pelo e-mail limpo.
--   3. A consulta do login (ldm_situacao_email), a ligação no primeiro acesso (gatilho) e a definição de
--      senha pelo administrador (ldm_admin_definir_senha) passam a comparar pelo e-mail limpo.
--   4. ldm_situacao_email deixa de mandar "clique em Primeiro acesso" para quem JÁ tem conta no Auth mas
--      ainda não estava ligada à pessoa (o "Primeiro acesso" responde "já tem acesso" e a pessoa fica num laço).
--
-- Rodar à mão, uma vez, no SQL Editor do projeto Supabase. Pode rodar de novo sem problema.

create or replace function acessos.email_limpo(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(regexp_replace(coalesce(p, ''), '[\s ​-‏‪-‮⁠-⁤﻿]', '', 'g'));
$$;

-- 2a. e-mails guardados, já limpos (sem tocar numa linha se a versão limpa já existir em outra pessoa)
update acessos.pessoas p
   set email = acessos.email_limpo(p.email)
 where p.email is distinct from acessos.email_limpo(p.email)
   and not exists (select 1 from acessos.pessoas q where q.id <> p.id and q.email = acessos.email_limpo(p.email));

-- 2b. contas que existiam antes do cadastro (ou que não ligaram por causa do caractere invisível)
update acessos.pessoas p
   set user_id = u.id
  from auth.users u
 where p.user_id is null
   and acessos.email_limpo(u.email) = acessos.email_limpo(p.email)
   and not exists (select 1 from acessos.pessoas q where q.user_id = u.id);

-- 3a. consulta do login: "esse e-mail está em que situação?"
create or replace function public.ldm_situacao_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = acessos, public, pg_temp
as $$
declare
  v_limpo text := acessos.email_limpo(p_email);
  v_user_id uuid;
begin
  select p.user_id into v_user_id
  from acessos.pessoas p
  where acessos.email_limpo(p.email) = v_limpo
  limit 1;

  if not found then
    return 'nao_cadastrado';
  elsif v_user_id is not null then
    return 'tem_conta';
  elsif exists (select 1 from auth.users u where acessos.email_limpo(u.email) = v_limpo) then
    return 'tem_conta';   -- conta existe, só não estava ligada à pessoa
  else
    return 'sem_conta';
  end if;
end;
$$;
grant execute on function public.ldm_situacao_email(text) to anon, authenticated;

-- 3b. primeiro acesso: liga o login novo ao cadastro feito pelo administrador, pelo e-mail limpo
create or replace function acessos.vincular_novo_usuario()
returns trigger language plpgsql security definer set search_path = acessos, pg_temp
as $$
declare
  v_email text := acessos.email_limpo(new.email);
begin
  update acessos.pessoas set user_id = new.id
   where acessos.email_limpo(email) = v_email and user_id is null;
  return new;
end;
$$;

-- 3c. administrador define a senha de outra pessoa (013), agora pelo e-mail limpo
create or replace function public.ldm_admin_definir_senha(p_email text, p_senha text)
returns text
language plpgsql
security definer
set search_path = acessos, public, extensions, pg_temp
as $$
declare
  v_email text := acessos.email_limpo(p_email);
  v_id uuid;
begin
  if not acessos.eh_admin() then
    raise exception 'Só um administrador pode definir a senha de outra pessoa.' using errcode = '42501';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa de pelo menos 6 caracteres.';
  end if;
  if not exists (select 1 from acessos.pessoas where acessos.email_limpo(email) = v_email) then
    raise exception 'Esta pessoa não está cadastrada em Configurações.';
  end if;

  select id into v_id from auth.users where acessos.email_limpo(email) = v_email limit 1;
  if v_id is null then
    return 'sem_conta';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;

  update acessos.pessoas set user_id = v_id
   where acessos.email_limpo(email) = v_email and user_id is null;

  return 'ok';
end;
$$;
revoke all on function public.ldm_admin_definir_senha(text, text) from public, anon;
grant execute on function public.ldm_admin_definir_senha(text, text) to authenticated;
