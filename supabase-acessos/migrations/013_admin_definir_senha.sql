-- Administrador define a senha de outra pessoa (Configurações do hub → "Definir senha").
--
-- Caso de uso: a pessoa foi liberada, mas não consegue entrar (esqueceu a senha, nunca criou, e-mail com
-- conta antiga...). O administrador escolhe uma senha, passa para ela, e ela entra com e-mail + senha.
--
-- Só administrador consegue chamar. A pessoa precisa estar cadastrada em acessos.pessoas.
-- A senha vai para o banco já como hash (bcrypt) — o texto da senha nunca é guardado.
--
-- Retorno:
--   'ok'        → senha definida (e conta confirmada e ligada à pessoa pelo e-mail)
--   'sem_conta' → a pessoa não tem conta no Supabase Auth ainda; o hub cria a conta pelo cadastro normal
--                 e chama a função de novo para confirmar e ligar.
--
-- Rodar à mão, uma vez, no SQL Editor do projeto Supabase.
create or replace function public.ldm_admin_definir_senha(p_email text, p_senha text)
returns text
language plpgsql
security definer
set search_path = acessos, public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not acessos.eh_admin() then
    raise exception 'Só um administrador pode definir a senha de outra pessoa.' using errcode = '42501';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa de pelo menos 6 caracteres.';
  end if;
  if not exists (select 1 from acessos.pessoas where lower(email) = v_email) then
    raise exception 'Esta pessoa não está cadastrada em Configurações.';
  end if;

  select id into v_id from auth.users where lower(email) = v_email limit 1;
  if v_id is null then
    return 'sem_conta';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;

  -- Conta criada antes de a pessoa ser cadastrada (ou por outro caminho) fica sem ligação; liga pelo e-mail.
  update acessos.pessoas set user_id = v_id where lower(email) = v_email and user_id is null;

  return 'ok';
end;
$$;

revoke all on function public.ldm_admin_definir_senha(text, text) from public, anon;
grant execute on function public.ldm_admin_definir_senha(text, text) to authenticated;
