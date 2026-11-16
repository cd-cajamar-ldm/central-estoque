-- 009 — NET: painel do fluxo automático (aba "NET" do app de fechamento NET)
--
-- O painel lê a base QRY410 que o Inventário Rotativo guarda na nuvem (ir_dados,
-- chave 'net410'), mas SÓ o resumo por mês × item × depósito × observação, e não o
-- arquivo inteiro (que passa de 40 MB). Roda no servidor com a permissão do próprio
-- app NET: quem tem acesso ao app 'net' enxerga o painel sem precisar de acesso ao
-- Inventário. Nada é gravado: é só leitura.
--
-- O fechamento da controladoria NÃO usa esta função: continua saindo da base
-- importada manualmente no app NET.

create or replace function public.net_fluxo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, acessos
as $$
begin
  if not acessos.pode_acessar('net') then
    raise exception 'Sem acesso ao app NET' using errcode = '42501';
  end if;

  return (
    with l as (
      select x.mes, x.item, x.nome, coalesce(x.deposito, '') as deposito,
             case when coalesce(x."obsWms", '') <> '' then x."obsWms" else coalesce(x.observacao, '') end as obs,
             x.valor, x.qtd
      from public.ir_dados d,
           jsonb_array_elements(d.dados) a,
           jsonb_to_recordset(a -> 'linhasLogica') as x(mes text, item text, nome text, deposito text,
                                                        "obsWms" text, observacao text, valor numeric, qtd numeric)
      where d.chave = 'net410' and d.parte > 0
    ),
    g as (
      select mes, item, deposito, obs,
             coalesce(sum(valor) filter (where valor > 0), 0) as gp,
             coalesce(sum(valor) filter (where valor < 0), 0) as pp,
             coalesce(sum(qtd), 0) as q
      from l group by 1, 2, 3, 4
    ),
    rm as (select mes, row_number() over (order by mes) as rn from (select distinct mes from g) z),
    ri as (select item, row_number() over (order by item) as rn from (select distinct item from g) z),
    rd as (select deposito, row_number() over (order by deposito) as rn from (select distinct deposito from g) z),
    ro as (select obs, row_number() over (order by obs) as rn from (select distinct obs from g) z),
    nm as (select jsonb_object_agg(item, nome) j
           from (select distinct on (item) item, nome from l where nome <> '' order by item) z)
    select jsonb_build_object(
      'meses',      (select jsonb_agg(mes order by rn) from rm),
      'itens',      (select jsonb_agg(item order by rn) from ri),
      'depositos',  (select jsonb_agg(deposito order by rn) from rd),
      'obs',        (select jsonb_agg(obs order by rn) from ro),
      'nomes',      (select j from nm),
      -- cada linha: [mês, item, depósito, observação] (posições a partir de 1), ganho, perda, peças
      'linhas',     (select jsonb_agg(jsonb_build_array(rm.rn, ri.rn, rd.rn, ro.rn,
                                                        round(g.gp, 2), round(g.pp, 2), round(g.q, 0)))
                     from g join rm using (mes) join ri using (item) join rd using (deposito) join ro using (obs))
    )
  );
end;
$$;

revoke all on function public.net_fluxo() from public;
grant execute on function public.net_fluxo() to authenticated;
