/* ============================================================
   Múltiplos Descasados — Regras e fórmulas
   (usado pelo Web Worker e pela UI)
   ============================================================
   O QUE É UM MÚLTIPLO
   Um item pai que só existe fisicamente como um conjunto de componentes. A
   ZBIQ0051 é a única fonte dessa ligação: quem não aparece nela como
   item_componente NÃO é múltiplo e não entra neste módulo. A QRY0390 traz a
   coluna ITEM_PAI, mas hoje ela repete o próprio item em todas as linhas —
   por isso o pai vem sempre da 051, nunca da 390.

   O QUE É "DESCASADO"
   O estoque é registrado nos componentes, não no pai. Com 5 corpos de caneta e
   4 tampas dá pra montar 4 canetas: o 5º corpo está descasado — ocupa endereço,
   carrega valor e não pode virar pedido. É essa peça que precisa ser bloqueada
   em 86 pra não cair em pedido um item que não está completo.

   A CONTA
     múltiplos completos = piso do menor (saldo do componente / qtde por múltiplo)
     sobra do componente = saldo - completos x qtde
   Componente da estrutura que não aparece na 390 conta saldo zero — e é o caso
   mais grave, porque zera os múltiplos completos e deixa TODO o resto descasado.
   ============================================================ */

/* Normaliza código de item. A 051 traz o código como número (857513.0) e a 390
   como inteiro; sem isso o cruzamento falha em silêncio e o módulo mostra tudo
   zerado, que é o pior jeito de errar. */
function mdNormItemKey(v){
  const s = String(v ?? '').trim();
  if(s==='') return '';
  const n = Number(s);
  return (Number.isFinite(n) && Number.isInteger(n)) ? String(n) : s;
}
function mdNormKey(s){
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'');
}

/* Preço unitário do componente.
   Ordem: o VALOR_UNITARIO da própria 390, quando existir. Como nos múltiplos
   ele vem zerado (a valoração do kit está no pai, não nas partes), entra a
   SIGEQ278: o preço de custo do PAI é atribuído ao componente marcado
   in_interface = 'S' na 051 — é ele que carrega o valor do conjunto, mesma
   regra que o Inventário usa pra valorar múltiplo. Os demais componentes valem
   zero por definição, não por falta de dado. */
function mdPrecoComponente(comp, saldo, precoPai){
  const daNota = (saldo && saldo.valorUnitario) || 0;
  if(daNota > 0) return daNota;
  if(comp && comp.inInterface === 'S') return precoPai || 0;
  return 0;
}

/* Monta a visão por item pai.
   estrutura: linhas da 051 {componente, pai, qtde, inInterface}
   saldos:    Map item -> {qtde, qtdeDisp, valorUnitario, nome, ...}
   precos:    Map item -> preço de custo (SIGEQ278), pode vir vazio
   base:      'qtde' (tudo que existe) ou 'qtdeDisp' (só o disponível) */
function mdCalcularPais(estrutura, saldos, precos, base){
  const campo = base === 'qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const porPai = new Map();
  for(const linha of estrutura){
    if(!porPai.has(linha.pai)) porPai.set(linha.pai, []);
    porPai.get(linha.pai).push(linha);
  }

  const pais = [];
  for(const [pai, comps] of porPai){
    const precoPai = precos.get(pai) || 0;
    let temSaldo = false;
    const linhas = comps.map(c=>{
      const s = saldos.get(c.componente) || null;
      const saldo = s ? (s[campo] || 0) : 0;
      if(saldo > 0) temSaldo = true;
      return {
        componente: c.componente,
        nome: (s && s.nome) || '',
        inInterface: c.inInterface,
        qtdePorMultiplo: c.qtde > 0 ? c.qtde : 1,
        saldo,
        preco: mdPrecoComponente(c, s, precoPai),
        semFicha: !s,
        locais: (s && s.locais) || []
      };
    });

    // Pai sem nenhuma peça no CD não é um problema de descasamento — é só uma
    // estrutura cadastrada sem estoque. Fica de fora pra não afogar a tela com
    // 1.500 linhas zeradas quando só algumas centenas têm peça de verdade.
    if(!temSaldo) continue;

    const completos = Math.floor(Math.min(...linhas.map(l=>l.saldo / l.qtdePorMultiplo)));
    let sobraPecas = 0, sobraValor = 0, compsComSobra = 0, compsSobraSemPreco = 0;
    for(const l of linhas){
      l.sobra = l.saldo - completos * l.qtdePorMultiplo;
      l.valorSobra = l.sobra * l.preco;
      sobraPecas += l.sobra;
      sobraValor += l.valorSobra;
      if(l.sobra > 0){
        compsComSobra++;
        // Peça descasada sem preço nenhum: o valor da tela sai subestimado e a
        // tela precisa dizer quanto está faltando, em vez de mostrar um total
        // que parece completo.
        if(!l.preco) compsSobraSemPreco++;
      }
    }

    // Componente que falta (saldo zero) é o que trava o conjunto: enquanto ele
    // não chegar, nenhuma peça dos outros vira múltiplo. A tela precisa dizer
    // isso com todas as letras, porque a ação é diferente — não é bloquear e
    // esquecer, é ir atrás da peça que falta.
    const faltantes = linhas.filter(l=>l.saldo === 0).length;

    // Valor do múltiplo montado: preço do pai quando a 278 foi importada, senão
    // a soma do que os componentes carregam na própria 390.
    const valorMultiplo = precoPai || linhas.reduce((a,l)=>a + l.preco * l.qtdePorMultiplo, 0);

    pais.push({
      pai,
      nome: (linhas.find(l=>l.inInterface==='S' && l.nome) || linhas.find(l=>l.nome) || {}).nome || '',
      componentes: linhas.sort((a,b)=>b.sobra - a.sobra || a.componente.localeCompare(b.componente)),
      nComponentes: linhas.length,
      completos,
      faltantes,
      compsComSobra,
      compsSobraSemPreco,
      sobraPecas,
      sobraValor,
      valorMultiplo,
      pecasTotal: linhas.reduce((a,l)=>a + l.saldo, 0),
      descasado: sobraPecas > 0
    });
  }
  return pais;
}

/* Resumo de topo. Valor é sempre o da sobra — o que está imobilizado em peça
   que não pode virar pedido. */
function mdResumo(pais){
  const r = {
    paisComEstoque: pais.length, paisDescasados: 0,
    sobraPecas: 0, sobraValor: 0, completos: 0,
    paisIncompletos: 0, componentesComSobra: 0, componentesSemPreco: 0
  };
  for(const p of pais){
    r.completos += p.completos;
    r.sobraPecas += p.sobraPecas;
    r.sobraValor += p.sobraValor;
    r.componentesComSobra += p.compsComSobra;
    r.componentesSemPreco += p.compsSobraSemPreco;
    if(p.descasado) r.paisDescasados++;
    if(p.faltantes > 0) r.paisIncompletos++;
  }
  return r;
}

/* Lista plana pro bloqueio em 86: uma linha por componente com sobra, que é a
   peça a bloquear. Ordenada por valor, porque é por onde a operação começa. */
function mdListaBloqueio(pais){
  const out = [];
  for(const p of pais){
    for(const c of p.componentes){
      if(c.sobra <= 0) continue;
      out.push({
        pai: p.pai, nomePai: p.nome,
        componente: c.componente, nome: c.nome,
        inInterface: c.inInterface,
        saldo: c.saldo, qtdePorMultiplo: c.qtdePorMultiplo,
        completos: p.completos, bloquear: c.sobra,
        preco: c.preco, valor: c.valorSobra,
        locais: c.locais
      });
    }
  }
  return out.sort((a,b)=>b.valor - a.valor || b.bloquear - a.bloquear);
}

if(typeof self !== 'undefined' && typeof window === 'undefined'){
  self.mdNormItemKey = mdNormItemKey;
  self.mdNormKey = mdNormKey;
}
