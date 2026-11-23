-- A tabela acessos.log cresce uma linha por visita (todo app chama
-- ldm_registrar_acesso a cada abertura). O painel de Configurações buscava
-- TODAS essas linhas no navegador pra montar "Nº de visitas"/"Último acesso"
-- e a "Atividade recente" -- com o histórico crescendo, isso passou a
-- estourar o limite de 12s do painel (sintoma: "Demorou demais pra
-- responder", mesmo sozinho, sem nenhuma outra aba aberta).
--
-- Esta função devolve só o RESUMO (total de visitas + data da última) por
-- pessoa+app, já somado no banco -- uma linha por par, não uma por visita.
create or replace function public.ldm_log_resumo()
returns table(pessoa_id uuid, app_key text, total bigint, ultimo timestamptz)
language plpgsql security definer set search_path = acessos, public, pg_temp
as $$
begin
  if not acessos.eh_admin() then
    return;
  end if;
  return query
    select l.pessoa_id, l.app_key, count(*)::bigint as total, max(l.acessado_em) as ultimo
    from acessos.log l
    group by l.pessoa_id, l.app_key;
end;
$$;

grant execute on function public.ldm_log_resumo() to authenticated;
