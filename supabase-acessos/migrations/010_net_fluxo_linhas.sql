-- 010 — NET: lançamentos de um mês para os itens mais divergentes (aba "NET")
--
-- Complementa a função net_fluxo (009). Devolve, para o mês e para a lista de itens
-- informados, os lançamentos da QRY410 guardada pelo Inventário: documento, usuário,
-- data/hora, observação, depósito, departamento, peças e valor — é o "porquê" de cada
-- item aparecer entre os mais divergentes. Só leitura, mesma permissão do app NET.

create or replace function public.net_fluxo_linhas(p_mes text, p_itens text[])
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'item', x.item, 'dt', x."dtMov", 'dh', x."dataHora", 'doc', x."numDoc", 'usuario', x.usuario,
             'obs', case when coalesce(x."obsWms", '') <> '' then x."obsWms" else coalesce(x.observacao, '') end,
             'deposito', x.deposito, 'depto', x.depto, 'qtd', x.qtd, 'valor', x.valor)
           order by abs(x.valor) desc)
    from public.ir_dados d,
         jsonb_array_elements(d.dados) a,
         jsonb_to_recordset(a -> 'linhasLogica') as x(mes text, item text, "dtMov" text, "dataHora" text, "numDoc" text, usuario text,
                                                      "obsWms" text, observacao text, deposito text, depto text,
                                                      qtd numeric, valor numeric)
    where d.chave = 'net410' and d.parte > 0
      and x.mes = p_mes and x.item = any (p_itens)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.net_fluxo_linhas(text, text[]) from public;
grant execute on function public.net_fluxo_linhas(text, text[]) to authenticated;
