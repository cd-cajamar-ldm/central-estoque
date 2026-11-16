-- "E-mail ou senha incorretos" aparece tanto pra senha errada quanto pra um
-- e-mail que o Supabase Auth nunca viu (é assim que ele protege contra
-- adivinhação de e-mail cadastrado) -- por isso alguém que o admin JÁ
-- liberou em Configurações, mas que ainda não clicou em "Primeiro acesso"
-- pra criar a própria senha, recebe a mesma mensagem genérica e acha que o
-- acesso liberado não funcionou.
--
-- Esta função deixa a tela de login perguntar ao banco "esse e-mail está
-- em que situação?" depois de um login que falhou, pra trocar a mensagem
-- genérica por uma explicação certeira.
create or replace function public.ldm_situacao_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = acessos, public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  select p.user_id into v_user_id
  from acessos.pessoas p
  where lower(p.email) = lower(p_email)
  limit 1;

  if not found then
    return 'nao_cadastrado';
  elsif v_user_id is null then
    return 'sem_conta';
  else
    return 'tem_conta';
  end if;
end;
$$;

grant execute on function public.ldm_situacao_email(text) to anon, authenticated;
