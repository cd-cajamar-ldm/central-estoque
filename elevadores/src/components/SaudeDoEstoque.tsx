/* ============================================================
   Saude do estoque por fornecedor.

   Responde "quanto do que esta parado vira elevador vendavel". A
   leitura e por unidade, nao por SKU: 100 elevadores possiveis com 10
   travados sao 90% OK e 10% sem venda.

   Usa so o saldo do CD. Reversa fica de fora: peca em reversa nao
   esta disponivel para montar nem para vender.
   ============================================================ */
import { useMemo } from 'react';
import type { Componente } from '../domain/tipos';
import {
  listarPorFornecedor, saudePorFornecedor, semNadaNoEstoque, totalizarSaude,
} from '../domain/fornecedores';
import type { MapaPrecos } from '../domain/fornecedores';
import { cores } from '../config/tokens';
import { Cartao, Tabela, Td, Th, Vazio } from './ui';

const COR_OK = cores.semantico.verde;
const COR_TRAVADO = cores.laranja.base;

const formatoReal = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

/* Barra de proporcao: verde do que monta, laranja do que trava. Le-se
   de longe, sem precisar do numero.

   Fornecedor sem nenhum elevador possivel nao tem proporcao: 0 de 0
   nao e 0% nem 100%. A barra cheia de laranja dizia "tudo descasado"
   sobre quem simplesmente nao tem estoque. */
function Proporcao({ pct, potencial }: { pct: number; potencial: number }) {
  if (potencial === 0) {
    return <div className="eq-saude-barra vazia" title="Sem elevador possível neste fornecedor" />;
  }
  return (
    <div className="eq-saude-barra" title={`${pct.toFixed(0)}% dos elevadores possíveis montam hoje`}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: COR_OK }} />
    </div>
  );
}

/* Percentual so existe quando ha o que medir. */
function Pct({ pct, potencial }: { pct: number; potencial: number }) {
  if (potencial === 0) return <span style={{ color: 'var(--ink-soft)' }}>—</span>;
  return <>{pct.toFixed(0)}%</>;
}

export function SaudeDoEstoque({
  componentes,
  precos,
  saldo390,
}: {
  componentes: Componente[];
  /* Preco de custo do item pai (SIGEQ278), para o R$ parado. Sem
     importar, o KPI mostra R$ 0 em vez de sumir da tela. */
  precos?: MapaPrecos;
  /* Valor unitario por componente (QRY0390) - manda sobre o preco do
     pai quando vier preenchido (ver precoComponente no dominio). */
  saldo390?: MapaPrecos;
}) {
  const todas = useMemo(
    () => saudePorFornecedor(listarPorFornecedor(componentes, precos, saldo390)),
    [componentes, precos, saldo390]
  );
  const temPreco = (precos?.size ?? 0) > 0 || (saldo390?.size ?? 0) > 0;
  /* O total sai da lista inteira: quem foi escondido soma zero, entao
     esconder nao muda numero nenhum - so tira ruido da leitura. */
  const total = useMemo(() => totalizarSaude(todas), [todas]);
  const linhas = useMemo(() => todas.filter((l) => !semNadaNoEstoque(l)), [todas]);
  const escondidas = todas.length - linhas.length;

  if (linhas.length === 0) {
    return (
      <Cartao titulo="Saúde do estoque por fornecedor" descricao="quanto vira elevador vendável">
        <Vazio>Nenhum elevador na base importada.</Vazio>
      </Cartao>
    );
  }

  return (
    <Cartao
      titulo="Saúde do estoque por fornecedor"
      descricao={
        'quanto do estoque vira elevador vendável · só saldo do CD, sem reversa' +
        /* Dizer quantos sairam evita a pergunta "cade o fornecedor
           tal": ele nao sumiu, e nao tem nada no CD. */
        (escondidas > 0 ? ` · ${escondidas} fornecedor(es) sem saldo ficaram de fora` : '')
      }
    >
      <div className="eq-saude-topo">
        <div className="eq-saude-num">
          <span className="eq-saude-rot" style={{ color: COR_OK }}>Completos</span>
          <b style={{ color: COR_OK }}>{total.pctCompleto.toFixed(0)}%</b>
          <span className="eq-saude-det">{total.completos} de {total.potencial} elevadores</span>
        </div>
        <div className="eq-saude-num">
          <span className="eq-saude-rot" style={{ color: COR_TRAVADO }}>Descasados</span>
          <b style={{ color: COR_TRAVADO }}>{total.pctDescasado.toFixed(0)}%</b>
          <span className="eq-saude-det">{total.descasados} elevadores sem venda</span>
        </div>
        <div className="eq-saude-num">
          <span className="eq-saude-rot">Peças paradas</span>
          <b>{total.pecasParadas}</b>
          <span className="eq-saude-det">unidades sem par no CD</span>
        </div>
        <div className="eq-saude-num">
          <span className="eq-saude-rot" style={{ color: COR_TRAVADO }}>R$ parado</span>
          <b style={{ color: COR_TRAVADO }}>{formatoReal.format(total.valorParado)}</b>
          <span className="eq-saude-det">
            {temPreco ? 'pelo valor unitário (390) ou custo do pai (278)' : 'importe a 390 ou a 278 para valorar'}
          </span>
        </div>
      </div>

      {/* Preco vem primeiro do proprio componente na 390; quando ele
          nao vem preenchido, so o lado que carrega o S na 051 pega o
          preco do pai (278) - mesma regra do Multiplos Descasados.
          Quando a peca parada fica sem os dois, o R$ acima e o piso,
          nao o total. Sem isso o numero parece completo quando na
          verdade esta subestimado. */}
      {temPreco && total.componentesSemPreco > 0 && (
        <p className="eq-saude-aviso">
          <b>{total.componentesSemPreco}</b> dos <b>{total.componentesComSobra}</b> componentes
          descasados estão sem preço na 390 e na 278 — o R$ parado acima é o piso, não o total.
        </p>
      )}

      <Tabela>
        <thead>
          <tr>
            <Th>Fornecedor</Th>
            <Th alinha="right">Elevadores possíveis</Th>
            <Th alinha="right">Completos</Th>
            <Th alinha="right">Descasados</Th>
            <Th>Proporção</Th>
            <Th alinha="right">% OK</Th>
            <Th alinha="right">Peças paradas</Th>
            <Th alinha="right">R$ parado</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.fornecedor}>
              <Td>
                {l.fornecedor}
                <span className="eq-saude-skus">
                  {l.itens} SKU(s)
                  {l.itensDescasados > 0 && ` · ${l.itensDescasados} descasado(s)`}
                </span>
              </Td>
              <Td alinha="right" numerico>{l.potencial}</Td>
              <Td alinha="right" numerico>
                <b style={{ color: COR_OK }}>{l.completos}</b>
              </Td>
              <Td alinha="right" numerico>
                {l.descasados > 0 ? <b style={{ color: COR_TRAVADO }}>{l.descasados}</b> : '—'}
              </Td>
              <Td><Proporcao pct={l.pctCompleto} potencial={l.potencial} /></Td>
              <Td alinha="right" numerico><Pct pct={l.pctCompleto} potencial={l.potencial} /></Td>
              <Td alinha="right" numerico>{l.pecasParadas || '—'}</Td>
              <Td alinha="right" numerico>{l.valorParado > 0 ? formatoReal.format(l.valorParado) : '—'}</Td>
            </tr>
          ))}
          <tr className="eq-saude-total">
            <Td><b>Total</b></Td>
            <Td alinha="right" numerico><b>{total.potencial}</b></Td>
            <Td alinha="right" numerico><b>{total.completos}</b></Td>
            <Td alinha="right" numerico><b>{total.descasados}</b></Td>
            <Td><Proporcao pct={total.pctCompleto} potencial={total.potencial} /></Td>
            <Td alinha="right" numerico>
              <b><Pct pct={total.pctCompleto} potencial={total.potencial} /></b>
            </Td>
            <Td alinha="right" numerico><b>{total.pecasParadas}</b></Td>
            <Td alinha="right" numerico><b>{formatoReal.format(total.valorParado)}</b></Td>
          </tr>
        </tbody>
      </Tabela>
    </Cartao>
  );
}
