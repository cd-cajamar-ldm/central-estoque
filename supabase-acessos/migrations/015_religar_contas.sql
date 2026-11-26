-- Religa cada pessoa à conta (login) que tem o MESMO e-mail.
--
-- Sintoma: a pessoa entra com e-mail e senha corretos e vê "Acesso negado", mesmo liberada em Configurações.
-- Causa: o cadastro (acessos.pessoas.user_id) estava ligado a OUTRA conta — ou a nenhuma — e o banco só
-- reconhece o acesso quando o user_id é o da conta que acabou de entrar.
--
-- Regra: o e-mail identifica a pessoa. Se existe exatamente UMA conta com o mesmo e-mail (comparado sem espaço,
-- sem caractere invisível e sem diferenciar maiúsculas) e ela ainda não pertence a outra pessoa, o cadastro passa
-- a apontar para ela. Pode rodar de novo sem problema.
--
-- Rodar à mão no SQL Editor do Supabase. O último comando mostra o estado da Eliana.

update acessos.pessoas p
   set user_id = u.id
  from auth.users u
 where acessos.email_limpo(u.email) = acessos.email_limpo(p.email)
   and p.user_id is distinct from u.id
   and (select count(*) from auth.users u2 where acessos.email_limpo(u2.email) = acessos.email_limpo(p.email)) = 1
   and not exists (select 1 from acessos.pessoas q where q.user_id = u.id and q.id <> p.id);

-- Conferência (mude o nome se quiser olhar outra pessoa):
select p.nome,
       p.email,
       p.ativo,
       p.papel,
       (p.user_id is not null)                                              as ligada_a_uma_conta,
       (select u.email from auth.users u where u.id = p.user_id)           as e_mail_da_conta_ligada,
       (select count(*) from auth.users u where acessos.email_limpo(u.email) = acessos.email_limpo(p.email)) as contas_com_esse_email,
       (select string_agg(pm.app_key || ' (' || pm.nivel || ')', ', ')
          from acessos.permissoes pm where pm.pessoa_id = p.id)             as apps_liberados
  from acessos.pessoas p
 where p.nome ilike '%eliana%';
