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
   O estoque é registrado nos componentes, não no pai, e cada peça carrega uma
   RESTRIÇÃO. Só o que está em WN (0 — estoque vendável) pode virar pedido, e
   por isso só o WN casa. Com 5 corpos de caneta e 4 tampas em WN dá pra vender
   4 canetas: o 5º corpo está descasado e precisa ir pra 86 (AI — múltiplos
   incompletos dentro do estoque), senão cai pedido de uma caneta que não
   existe inteira.

   O CAMINHO DE VOLTA
   O 86 não é destino final. Quando a peça que faltava aparece (recebimento,
   inventário), o conjunto volta a casar e o que está em 86 tem que voltar pra
   WN — senão fica estoque bom parado, invisível pra venda. Por isso a conta
   olha o POTENCIAL (WN + 86) e não só o WN:

     alvo por componente = piso do menor ((WN + 86) / qtde por múltiplo) x qtde
     WN acima do alvo  -> bloquear   0  -> 86
     WN abaixo do alvo -> liberar   86  ->  0   (limitado ao saldo em 86)

   Um componente nunca tem as duas ações ao mesmo tempo: ou sobra WN, ou falta.
   As demais restrições (DT, WA, RT...) ficam de fora — não vendem, não casam e
   não são mexidas por este módulo.
   ============================================================ */

/* Legenda de restrições do WMS. O coletor pede o CÓDIGO (0, 86), a 390 traz a
   SIGLA (WN, AI) — o módulo precisa das duas pontas: a sigla pra ler a planilha
   e o código pra escrever o relatório que vai ser digitado. */
const MD_RESTRICOES = [
  {cod:'0',  sigla:'WN', nome:'Estoque vendável'},
  {cod:'10', sigla:'WA', nome:'Estoque reversa'},
  {cod:'15', sigla:'WQ', nome:'Sem condições de venda (quebra)'},
  {cod:'20', sigla:'RT', nome:'Em conferência do recebimento'},
  {cod:'25', sigla:'WE', nome:'Amostra / correção de cadastro / assistência técnica'},
  {cod:'34', sigla:'LT', nome:'Litígio'},
  {cod:'35', sigla:'WV', nome:'Fora do prazo de validade'},
  {cod:'40', sigla:'WL', nome:'Estoque físico não localizado'},
  {cod:'50', sigla:'WT', nome:'Análise de item'},
  {cod:'55', sigla:'WR', nome:'Reparo interno'},
  {cod:'60', sigla:'AT', nome:'Múltiplos incompletos da reversa (componentes)'},
  {cod:'61', sigla:'SS', nome:'Componentes de peças da marca própria'},
  {cod:'62', sigla:'DT', nome:'Restrição de triagem'},
  {cod:'65', sigla:'WD', nome:'Devolução de obsoletos ou acordo comercial'},
  {cod:'75', sigla:'WS', nome:'Leilão'},
  {cod:'86', sigla:'AI', nome:'Múltiplos incompletos dentro do estoque'}
];
const MD_SIGLA_VENDAVEL = 'WN';   // código 0
const MD_SIGLA_BLOQUEIO = 'AI';   // código 86
const MD_COD_POR_SIGLA = MD_RESTRICOES.reduce((m,r)=>{ m[r.sigla] = r.cod; return m; }, {});
const MD_NOME_POR_SIGLA = MD_RESTRICOES.reduce((m,r)=>{ m[r.sigla] = r.nome; return m; }, {});
function mdCodRestricao(sigla){ return MD_COD_POR_SIGLA[sigla] ?? ''; }
function mdNomeRestricao(sigla){ return MD_NOME_POR_SIGLA[sigla] || sigla || '—'; }
/* Ordem das colunas de restrição na tela: primeiro as duas que mandam no
   módulo (vendável e bloqueio), depois as outras na ordem da legenda. */
const MD_ORDEM_RESTRICOES = [MD_SIGLA_VENDAVEL, MD_SIGLA_BLOQUEIO]
  .concat(MD_RESTRICOES.map(r=>r.sigla).filter(s=>s!==MD_SIGLA_VENDAVEL && s!==MD_SIGLA_BLOQUEIO));

/* O coletor pede o endereço com 10 dígitos: ID do local completado com zero à
   esquerda depois do 5 (5000132564 pro local 132564, de 6 dígitos). Local de
   7 dígitos usa menos zero (500 em vez de 5000) pra fechar nos mesmos 10 —
   grudar sempre "5000" na frente estourava o endereço quando o local vinha
   com um dígito a mais. */
function mdLocalColetor(idLocal){
  const s = String(idLocal ?? '').trim();
  if(!s) return '';
  const prefixo = '5' + '0'.repeat(Math.max(0, 9 - s.length));
  return prefixo + s;
}

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

function mdSaldoRestricao(saldo, sigla, campo){
  if(!saldo || !saldo.porRestricao) return 0;
  const r = saldo.porRestricao[sigla];
  return r ? (r[campo] || 0) : 0;
}

/* Monta a visão por item pai.
   estrutura: linhas da 051 {componente, pai, qtde, inInterface}
   saldos:    Map item -> {porRestricao, locais, valorUnitario, nome, ...}
   precos:    Map item -> preço de custo (SIGEQ278), pode vir vazio
   base:      'qtde' (tudo que existe) ou 'qtdeDisp' (só o disponível)
   restricaoPermitida: função opcional (endereço)->bool, a mesma regra de
   classe/X1 da aba Ajustes de Restrição (ver mdRestricaoPermitida em app.js).
   Sem ela, todo WN/86 do dado conta pro pareamento, como sempre foi. */
function mdCalcularPais(estrutura, saldos, precos, base, restricaoPermitida){
  const campo = base === 'qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const porPai = new Map();
  for(const linha of estrutura){
    if(!porPai.has(linha.pai)) porPai.set(linha.pai, []);
    porPai.get(linha.pai).push(linha);
  }

  const pais = [];
  for(const [pai, comps] of porPai){
    const infoPai = precos.get(pai) || {};
    const precoPai = infoPai.preco || 0;
    let temSaldo = false;
    const linhas = comps.map(c=>{
      const s = saldos.get(c.componente) || null;
      const total = s ? (s[campo] || 0) : 0;
      if(total > 0) temSaldo = true;
      let wn = mdSaldoRestricao(s, MD_SIGLA_VENDAVEL, campo);
      let bloq = mdSaldoRestricao(s, MD_SIGLA_BLOQUEIO, campo);
      // Endereço em WN ou 86 mas fora da regra de classe/X1 (ex.: reversa
      // cadastrada como WN) não é vendável nem múltiplo incompleto de
      // verdade ali — é saldo mal classificado no WMS. Desconta do WN/86
      // que entra no pareamento; some em "outras" como qualquer restrição
      // que não participa, sem mudar o total nem a coluna exibida na tela.
      if(restricaoPermitida && s && s.locais){
        for(const loc of s.locais){
          const v = loc[campo] || 0;
          if(!v || restricaoPermitida(loc)) continue;
          if(loc.restricao === MD_SIGLA_VENDAVEL) wn -= v;
          else if(loc.restricao === MD_SIGLA_BLOQUEIO) bloq -= v;
        }
      }
      const porRestricao = {};
      if(s && s.porRestricao){
        for(const sigla in s.porRestricao){
          const v = s.porRestricao[sigla][campo] || 0;
          if(v) porRestricao[sigla] = v;
        }
      }
      return {
        componente: c.componente,
        nome: (s && s.nome) || '',
        nomePai: (s && s.nomePai) || '',
        ean: (s && s.ean) || '',
        log: (s && s.log) || '',
        inInterface: c.inInterface,
        qtdePorMultiplo: c.qtde > 0 ? c.qtde : 1,
        wn, bloqueado: bloq,
        outras: total - wn - bloq,
        total,
        porRestricao,
        preco: mdPrecoComponente(c, s, precoPai),
        semFicha: !s,
        locais: (s && s.locais) || []
      };
    });

    // Pai sem nenhuma peça no CD não é um problema de descasamento — é só uma
    // estrutura cadastrada sem estoque. Fica de fora pra não afogar a tela com
    // 1.500 linhas zeradas quando só algumas centenas têm peça de verdade.
    if(!temSaldo) continue;

    // Casado de hoje: só o que está vendável. Casado possível: contando o que
    // está preso em 86, que é justamente o que pode voltar.
    const completos = Math.floor(Math.min(...linhas.map(l=>l.wn / l.qtdePorMultiplo)));
    const completosPotencial = Math.floor(Math.min(...linhas.map(l=>(l.wn + l.bloqueado) / l.qtdePorMultiplo)));

    let bloquearPecas = 0, liberarPecas = 0, bloquearValor = 0, liberarValor = 0, compsSobraSemPreco = 0, compsComSobra = 0;
    for(const l of linhas){
      const alvo = completosPotencial * l.qtdePorMultiplo;
      l.alvoWn = alvo;
      l.bloquear = Math.max(0, l.wn - alvo);
      l.liberar = Math.max(0, Math.min(l.bloqueado, alvo - l.wn));
      l.valorBloquear = l.bloquear * l.preco;
      l.valorLiberar = l.liberar * l.preco;
      bloquearPecas += l.bloquear;
      liberarPecas += l.liberar;
      bloquearValor += l.valorBloquear;
      liberarValor += l.valorLiberar;
      if(l.bloquear > 0){
        compsComSobra++;
        // Peça descasada sem preço nenhum: o valor da tela sai subestimado e a
        // tela precisa dizer quanto está faltando, em vez de mostrar um total
        // que parece completo.
        if(!l.preco) compsSobraSemPreco++;
      }
    }

    // "Falta componente" é o item cadastrado na estrutura que não tem NENHUM
    // saldo no CD, em restrição nenhuma — não ter WN nem 86 não quer dizer que
    // a peça não existe, pode estar em outra restrição (DT, WA...) e ainda
    // assim travar o conjunto, mas isso não é "faltando", é descasado em
    // outro lugar. Só conta quem realmente não tem peça física nenhuma.
    const faltantes = linhas.filter(l=>l.total === 0).length;

    // Valor do múltiplo montado: preço do pai quando a 278 foi importada, senão
    // a soma do que os componentes carregam na própria 390.
    const valorMultiplo = precoPai || linhas.reduce((a,l)=>a + l.preco * l.qtdePorMultiplo, 0);

    pais.push({
      pai,
      // Nome do PAI, não do componente. Ordem de confiança:
      // 1) SIGEQ278, pelo código do PRÓPRIO pai — é a fonte mais confiável que
      //    existe, porque não depende de nenhum componente carregar o nome
      //    certo. 2) NOME_ITEM_PAI da 390, só quando difere do nome do próprio
      //    componente que carregou o valor (na prática a coluna às vezes vem
      //    preenchida igual ao NOME_ITEM_FILHO daquela linha, o que não é o
      //    nome do pai — nesse caso ela não serve). 3) Sem nenhuma das duas,
      //    cai pro nome do componente que carrega o valor, pior que o nome
      //    certo mas melhor que ficar em branco.
      nome: infoPai.nome
        || (linhas.find(l=>l.nomePai && l.nomePai !== l.nome) || {}).nomePai
        || (linhas.find(l=>l.inInterface==='S' && l.nome) || linhas.find(l=>l.nome) || {}).nome || '',
      componentes: linhas.sort((a,b)=>(b.bloquear + b.liberar) - (a.bloquear + a.liberar) || a.componente.localeCompare(b.componente)),
      nComponentes: linhas.length,
      completos, completosPotencial,
      faltantes,
      compsComSobra,
      compsSobraSemPreco,
      bloquearPecas, liberarPecas,
      sobraValor: bloquearValor,
      liberarValor,
      valorMultiplo,
      wnTotal: linhas.reduce((a,l)=>a + l.wn, 0),
      bloqueadoTotal: linhas.reduce((a,l)=>a + l.bloqueado, 0),
      outrasTotal: linhas.reduce((a,l)=>a + l.outras, 0),
      pecasTotal: linhas.reduce((a,l)=>a + l.total, 0),
      descasado: bloquearPecas > 0 || liberarPecas > 0
    });
  }
  return pais;
}

/* Resumo de topo. Valor é o da sobra vendável — o que está imobilizado em peça
   que não pode virar pedido. */
function mdResumo(pais){
  const r = {
    paisComEstoque: pais.length, paisDescasados: 0,
    bloquearPecas: 0, liberarPecas: 0, sobraValor: 0, liberarValor: 0,
    completos: 0, completosPotencial: 0,
    paisIncompletos: 0, componentesComSobra: 0, componentesSemPreco: 0,
    paisABloquear: 0, paisALiberar: 0
  };
  for(const p of pais){
    r.completos += p.completos;
    r.completosPotencial += p.completosPotencial;
    r.bloquearPecas += p.bloquearPecas;
    r.liberarPecas += p.liberarPecas;
    r.sobraValor += p.sobraValor;
    r.liberarValor += p.liberarValor;
    r.componentesComSobra += p.compsComSobra;
    r.componentesSemPreco += p.compsSobraSemPreco;
    if(p.descasado) r.paisDescasados++;
    if(p.bloquearPecas > 0) r.paisABloquear++;
    if(p.liberarPecas > 0) r.paisALiberar++;
    if(p.faltantes > 0) r.paisIncompletos++;
  }
  return r;
}

/* ============================================================
   PLANO DE AJUSTE
   ============================================================
   A alteração de restrição no coletor é POR ENDEREÇO: o operador digita o
   local, a restrição de origem, a de destino e a quantidade. Então não basta
   dizer "bloqueie 3 peças deste item" — é preciso dizer de quais endereços
   sair, porque é assim que a tela 12.MOVI funciona e porque o sistema só
   aceita a baixa se aquele endereço tiver mesmo o saldo naquela restrição.

   E precisa ser por LOTE, não só por endereço: quando o mesmo endereço tem
   mais de um lote (a 390 traz uma linha por lote), o coletor recusa mover
   uma quantidade que precise juntar dois lotes — dá "IMPOSSÍVEL FUNDIR". Por
   isso a alocação usa `refs` (um lote por entrada), nunca o total já somado
   do endereço: cada linha do plano sai do tamanho exato de UM lote, sempre
   executável num passo só.

   Os lotes são consumidos do maior saldo pro menor: menos linhas pra
   digitar, e a sobra costuma estar concentrada num lote só.

   restricaoPermitida (opcional): mesma regra de classe/X1 de Configurações
   usada antes de parear (mdPais). Endereço de reversa com WN fora da regra
   não conta como vendável de verdade — não pode virar origem de um bloquear
   (0→86) nem de um liberar (86→0) só porque a coluna diz WN/86. Quem precisa
   de ajuste é sempre o endereço "certo" (ex.: o do CD), nunca a reversa. */
function mdAlocarPorEndereco(locais, sigla, quantidade, campo, restricaoPermitida){
  const disponiveis = [];
  for(const l of (locais || [])){
    if(String(l.restricao || '').toUpperCase() !== sigla) continue;
    if(restricaoPermitida && !restricaoPermitida(l)) continue;
    // refs é o normal (um lote por linha da 390); sem ele (dado antigo em
    // cache), cai pro total do endereço — pior que o ideal, mas não quebra.
    const refs = (l.refs && l.refs.length) ? l.refs : [{qtde: l.qtde, qtdeDisp: l.qtdeDisp}];
    for(const ref of refs){
      // Quantidade romaneada (QTDE_ROM) já está separada pra um pedido — não
      // entra na conta do que dá pra mover. Sobrando parte não-romaneada no
      // mesmo lote, essa parte continua concorrendo normalmente.
      const saldo = Math.max(0, (ref[campo] || 0) - (ref.qtdeRom || 0));
      if(saldo > 0) disponiveis.push({local: l.local, desc: l.desc, predio: l.predio, clal: l.clal, x1: l.x1, x2: l.x2, saldoLocal: saldo});
    }
  }
  disponiveis.sort((a,b)=>b.saldoLocal - a.saldoLocal);

  const out = [];
  let resta = quantidade;
  for(const l of disponiveis){
    if(resta <= 0) break;
    const usa = Math.min(resta, l.saldoLocal);
    out.push({local: l.local, desc: l.desc, predio: l.predio, clal: l.clal, x1: l.x1, x2: l.x2, saldoLocal: l.saldoLocal, quantidade: usa});
    resta -= usa;
  }
  // Sobrou quantidade sem endereço: a soma por restrição e a soma por endereço
  // não fecharam. Devolvido como linha "sem endereço" pra aparecer na tela em
  // vez de sumir da conta.
  if(resta > 0) out.push({local:'', desc:'', predio:'', clal:'', x1:'', x2:'', saldoLocal:0, quantidade: resta, semEndereco:true});
  return out;
}

/* Uma linha por endereço e sentido — é exatamente o que será digitado.
   base: 'qtde' ou 'qtdeDisp', o mesmo corte usado no cálculo.
   restricaoPermitida: mesma regra passada pra mdCalcularPais — sem ela aqui,
   o bloquear/liberar já calculado sem a reversa contar como WN/86 de verdade
   ainda poderia escolher a própria reversa como endereço de execução. */
function mdPlanoAjuste(pais, base, restricaoPermitida){
  const campo = base === 'qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const out = [];
  for(const p of pais){
    for(const c of p.componentes){
      const acoes = [];
      if(c.bloquear > 0) acoes.push({sentido:'bloquear', de: MD_SIGLA_VENDAVEL, para: MD_SIGLA_BLOQUEIO, qtd: c.bloquear});
      if(c.liberar > 0) acoes.push({sentido:'liberar', de: MD_SIGLA_BLOQUEIO, para: MD_SIGLA_VENDAVEL, qtd: c.liberar});
      for(const a of acoes){
        for(const alvo of mdAlocarPorEndereco(c.locais, a.de, a.qtd, campo, restricaoPermitida)){
          out.push({
            sentido: a.sentido,
            de: a.de, para: a.para,
            codDe: mdCodRestricao(a.de), codPara: mdCodRestricao(a.para),
            localColetor: mdLocalColetor(alvo.local),
            local: alvo.local, endereco: alvo.desc, predio: alvo.predio, clal: alvo.clal, x1: alvo.x1, x2: alvo.x2,
            saldoLocal: alvo.saldoLocal, semEndereco: !!alvo.semEndereco,
            quantidade: alvo.quantidade,
            pai: p.pai, nomePai: p.nome,
            componente: c.componente, nome: c.nome, ean: c.ean,
            inInterface: c.inInterface,
            qtdePorMultiplo: c.qtdePorMultiplo,
            wn: c.wn, bloqueado: c.bloqueado, alvoWn: c.alvoWn,
            completos: p.completos, completosPotencial: p.completosPotencial,
            preco: c.preco, valor: alvo.quantidade * c.preco,
            totalComponente: c.total
          });
        }
      }
    }
  }
  // Bloquear antes de liberar: bloqueio é o que evita venda de item incompleto,
  // e é o que não pode esperar. Dentro de cada sentido, o de maior valor.
  const peso = {bloquear:0, liberar:1};
  return out.sort((a,b)=>
    peso[a.sentido] - peso[b.sentido] ||
    b.valor - a.valor ||
    b.quantidade - a.quantidade
  );
}

if(typeof self !== 'undefined' && typeof window === 'undefined'){
  self.mdNormItemKey = mdNormItemKey;
  self.mdNormKey = mdNormKey;
}
