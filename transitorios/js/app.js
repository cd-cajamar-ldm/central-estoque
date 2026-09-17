/* ============================================================
   GESTÃO DE TRANSITÓRIOS — app
   ============================================================
   A tela saiu da aba do Inventário Rotativo e virou módulo próprio: quem cuida
   de transitório não precisa (nem quer) abrir a tela de ciclo pra chegar nela.

   O que NÃO mudou: a base continua sendo a QRY0390 importada no Inventário. Os
   dois módulos ficam no mesmo domínio, logo na MESMA ORIGEM, e o IndexedDB
   (inventario_rotativo_v1) é o mesmo — este módulo abre o banco só pra ler.
   Nada é importado duas vezes, e o que ele grava é só configuração do próprio
   transitório (setor por prefixo, nome de log, e-mail do boletim).

   Consequência a conhecer: em um navegador onde o Inventário nunca importou a
   390, esta tela não tem o que mostrar — e diz isso, em vez de aparecer vazia.
   ============================================================ */
const IR_APP_VERSION = 'v1';
const IR = {
  est390Meta:null, est390Locais:null, _est390Loading:false,
  transSetores:null, transNomes:null, transExpandido:null,
  transEmail:null, transEmailAberto:false,
  div410Cache:null, _itemInfo:null, _itemInfoLoading:false,
  _transGanhos:null, _transGanhosAno:null, _transGanhosLoading:false,
  _transGanhoLocal:null, _transGanhosDiag:null,
  initErro:null
};

const IR_MOBILE_QUERY = '(max-width:640px)';
const IR_ZOOM_MIN = 70, IR_ZOOM_MAX = 150, IR_ZOOM_STEP = 10;
function irEsc(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function irFmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function irFmtMoney(n){ return (n||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
function irFmtPct(n){ return ((n||0)*100).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1})+'%'; }
function irShowToast(msg, isError){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast'+(isError?' error':'');
  clearTimeout(window.__irToastTimer);
  window.__irToastTimer = setTimeout(()=>{ t.className='toast hidden'; }, 2600);
}
function irEmptyState(title, desc, onclickFn, btnLabel){
  return `<div class="empty-state panel"><div class="eicon">📦</div><h3>${irEsc(title)}</h3><p>${irEsc(desc)}</p>
    ${onclickFn ? `<button class="btn btn-primary" onclick="${onclickFn}">${irEsc(btnLabel)}</button>` : ''}</div>`;
}
async function irRasterizarSVGs(raiz, escala){
  const svgs = Array.from(raiz.querySelectorAll('svg'));
  for(const svg of svgs){
    const vb = (svg.getAttribute('viewBox')||'').split(/\s+/).map(Number);
    const w = Number(svg.getAttribute('width')) || vb[2] || svg.clientWidth;
    const h = Number(svg.getAttribute('height')) || vb[3] || svg.clientHeight;
    if(!w || !h) continue;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const texto = new XMLSerializer().serializeToString(clone);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(texto);
    try{
      const img = await new Promise((ok, falhou)=>{
        const i = new Image();
        i.onload = ()=>ok(i); i.onerror = falhou;
        i.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = w * escala; cv.height = h * escala;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const saida = document.createElement('img');
      saida.src = cv.toDataURL('image/png');
      saida.width = w; saida.height = h;
      // Herda a classe do SVG pra o CSS da folha continuar mandando no tamanho.
      // Escalar agora é seguro: é PNG a 3x, não mais um SVG pra ele interpretar.
      saida.className = svg.getAttribute('class') || '';
      saida.style.cssText = svg.getAttribute('style') || '';
      saida.style.display = 'block';
      svg.replaceWith(saida);
    }catch(err){ /* falhou a rasterização: deixa o SVG como está */ }
  }
}
async function irBaixarBoletimImagem(html, nomeArquivo, email){
  if(typeof html2canvas==='undefined'){ irShowToast('Não consegui carregar o gerador de imagem (sem internet?).', true); return; }
  const area = document.getElementById('irPrintArea');
  area.innerHTML = html;
  // Cobre a tela inteira (em vez de posicionar fora da viewport, que causava o
  // html2canvas "vazar" pedaços do menu/sidebar na imagem capturada) — assim a
  // captura fica isolada, só com o conteúdo do boletim.
  // align-items:flex-start é essencial aqui: sem isso, o align-items:stretch padrão do
  // flex esticava (e limitava) a altura do .rp-page à viewport, cortando o boletim pela
  // metade na imagem capturada pelo html2canvas.
  area.style.cssText = 'display:flex; justify-content:center; align-items:flex-start; position:fixed; inset:0; z-index:9999; overflow:auto; background:#F6F7FA;';
  irShowToast('Gerando boletim...');
  // O zoom da tela (document.body.style.zoom, o controle no canto inferior) é uma
  // propriedade CSS não padrão que o html2canvas não sabe medir — com ele diferente
  // de 100% a métrica de texto do canvas saía errada e as palavras vinham coladas,
  // sem espaço, na imagem capturada. Zera o zoom só durante a captura e restaura
  // (mesmo em caso de erro) logo depois.
  const zoomOriginal = document.body.style.zoom;
  document.body.style.zoom = 1;
  try{
    await new Promise(r=>setTimeout(r, 60)); // deixa o layout assentar antes de capturar
    const alvo = area.querySelector('.rp-page');
    await irRasterizarSVGs(alvo, 3);
    const canvas = await html2canvas(alvo, {
      backgroundColor:'#F6F7FA', scale:3, useCORS:true,
      width: alvo.scrollWidth, height: alvo.scrollHeight,
      windowWidth: alvo.scrollWidth, windowHeight: alvo.scrollHeight
    });
    const blob = await new Promise(resolve=>canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    const numero = IR.cicloAtivo ? IR.cicloAtivo.numero : '';
    const assunto = (email && email.assunto) || `Boletim Inventário — Ciclo ${numero}`;
    let compartilhou = false;
    /* Com destinatários configurados o mailto ganha da folha de compartilhamento:
       ela anexa a imagem sozinha, mas não deixa preencher quem recebe — e o
       pedido aqui é justamente não redigitar os responsáveis todo dia. Anexar
       fica manual; o corpo leva os números em texto pra o e-mail já valer alguma
       coisa mesmo antes de anexar. */
    if(email && (email.para || email.cc)){
      // RFC 6068 separa endereços por vírgula; o usuário digita com ponto e
      // vírgula, que é o que o Outlook mostra. Normaliza pra vírgula.
      const lista = v => (v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean).join(',');
      const q = [];
      if(email.cc) q.push('cc='+encodeURIComponent(lista(email.cc)));
      q.push('subject='+encodeURIComponent(assunto));
      q.push('body='+encodeURIComponent((email.corpo||'')+
        `\n\n— Anexe a imagem "${nomeArquivo}", baixada agora na sua pasta de downloads.`));
      window.open('mailto:'+encodeURIComponent(lista(email.para))+'?'+q.join('&'), '_blank');
      irShowToast('✓ Boletim baixado e e-mail aberto — anexe a imagem e envie.');
      return;
    }
    // Se o navegador suportar compartilhar arquivo (Web Share API), abre direto
    // a folha de compartilhamento nativa — o usuário escolhe o e-mail e já
    // manda com a imagem anexada, só falta escolher os destinatários.
    if(navigator.canShare){
      try{
        const file = new File([blob], nomeArquivo, {type:'image/png'});
        if(navigator.canShare({files:[file]})){
          await navigator.share({files:[file], title:assunto, text:assunto});
          compartilhou = true;
        }
      }catch(shareErr){
        if(shareErr && shareErr.name==='AbortError') compartilhou = true; // usuário cancelou, não é erro
      }
    }
    if(!compartilhou){
      // Sem suporte a compartilhar arquivo: abre um rascunho de e-mail vazio
      // (sem destinatário) pra o usuário só preencher quem recebe e anexar a
      // imagem que já foi baixada — o mailto não permite anexar automaticamente.
      const corpo = `Segue o boletim do Ciclo ${numero}.\n\nAnexe o arquivo "${nomeArquivo}" (baixado agora na pasta de downloads) antes de enviar.`;
      window.open(`mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`, '_blank');
      irShowToast('✓ Boletim baixado e rascunho de e-mail aberto — anexe a imagem e adicione os destinatários.');
    } else {
      irShowToast('✓ Boletim pronto — escolha os destinatários na tela de compartilhamento.');
    }
  }catch(err){
    irShowToast('Erro ao gerar o boletim: '+err.message, true);
  }finally{
    document.body.style.zoom = zoomOriginal;
    area.style.cssText = '';
    area.innerHTML = '';
  }
}
async function irCarregarItemInfo(){
  if(IR._itemInfo || IR._itemInfoLoading) return;
  IR._itemInfoLoading = true;
  try{
    const linhas = await irGetItemInfoTodos();
    IR._itemInfo = new Map(linhas.map(l=>[l.item, l]));
  }catch(err){ IR._itemInfo = new Map(); }
  finally{ IR._itemInfoLoading = false; }
}
function irItemInfo(item){ return (IR._itemInfo && IR._itemInfo.get(irDivNormItem(item))) || null; }
function irDivNormItem(v){
  const s = String(v ?? '').trim();
  if(s==='') return '';
  const n = Number(s);
  return (Number.isFinite(n) && Number.isInteger(n)) ? String(n) : s;
}
function irDivCarregando(){
  return `<div class="panel div-carregando"><span class="div-spinner"></span>Carregando divergências e preços do período...</div>`;
}
function irApplyZoom(pct){
  pct = Math.max(IR_ZOOM_MIN, Math.min(IR_ZOOM_MAX, pct));
  document.body.style.zoom = (pct/100);
  /* O zoom encolhe a unidade de viewport junto com o resto: a 80%, o .shell de
     100dvh ocupava 80% da tela e sobrava uma faixa branca embaixo — quanto menor
     o zoom, menos área útil, que é o contrário do que se espera dele. Dividir a
     altura pelo fator devolve a tela inteira em qualquer zoom. */
  document.documentElement.style.setProperty('--zoom', pct/100);
  const label = document.getElementById('zoomLabel');
  if(label) label.textContent = pct+'%';
  localStorage.setItem('ir-zoom', pct);
}
function irZoomIn(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) + IR_ZOOM_STEP); }
function irZoomOut(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) - IR_ZOOM_STEP); }
function irToggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light');
  const next = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ir-theme', next);
  irUpdateThemeLabel();
}
function irUpdateThemeLabel(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light');
  const label = document.getElementById('themeToggleLabel');
  if(label) label.textContent = cur==='dark' ? 'Modo escuro' : 'Modo claro';
}
function irToggleSidebar(){
  const el = document.getElementById('sidebar');
  if(matchMedia(IR_MOBILE_QUERY).matches) el.classList.toggle('mobile-open');
  else el.classList.toggle('collapsed');
}
function irCloseSidebarMobile(){
  if(matchMedia(IR_MOBILE_QUERY).matches) document.getElementById('sidebar').classList.remove('mobile-open');
}
/* ============================================================
   TRANSITÓRIOS
   Estoque parado fora do endereço de picking, separado por SETOR responsável.
   A base é a QRY0390 agregada por endereço — importada na aba Importação,
   independente de ciclo.

   O prefixo do endereço (X1) é o que diz de quem é o saldo, e esse mapa é
   editável: só quem opera sabe que GAI é carga e DEV é devolução. O que não
   estiver mapeado aparece em "Não classificado", justamente pra ser resolvido em
   vez de sumir numa conta agregada.
   ============================================================ */
// IGN não é setor: é o endereço que não conta como transitório (expedição em uso,
// picking, área operacional normal). Fica visível num painel próprio pra ninguém
// achar que o número sumiu, mas fora do total.
const IR_TRANS_SETORES = ['TSF','C.E','INB','OUT','TRP','REV','IGN'];
const IR_TRANS_SETOR_NOME = {
  'C.E':'Controle de Estoque', INB:'Inbound', OUT:'Outbound',
  TRP:'Transporte', REV:'Reversa', TSF:'Transferência', IGN:'Desconsiderado'
};
/* O setor dono do endereço vem da CLASSE LOCAL do WMS: TSF, C.E, INB, OUT, TRP e
   REV são os códigos que a operação cadastra. Endereço novo com a classe certa
   entra no dashboard sozinho, sem ninguém mexer em configuração.

   O mapa por prefixo continua como rede de segurança, pro endereço antigo que
   ainda não tem classe. Quando nem um nem outro resolvem, o endereço cai em "não
   classificado" — que é o sinal de que falta classe no cadastro. */
/* A classe vinha comparada letra a letra com a lista, então só "C.E" exato
   entrava em Controle de Estoque: "CE", "C.E." ou "C E" — tudo a mesma classe pra
   quem cadastra no WMS — caíam em "não classificado" e o setor inteiro sumia do
   relatório. A comparação passa a ignorar ponto, espaço e hífen. */
const IR_TRANS_CLASSE_MAPA = IR_TRANS_SETORES.reduce((m,s)=>{
  m[s.replace(/[^A-Z0-9]/gi,'').toUpperCase()] = s; return m;
}, {});
function irTransSetorDe(l){
  const clal = IR_TRANS_CLASSE_MAPA[String(l.clal||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase()];
  if(clal) return clal;
  // Sem classe cadastrada não há setor. O palpite por prefixo saiu: ele colocava
  // endereço no setor errado (RES caía em Controle de Estoque sem ser C.E) e
  // escondia justamente o que precisa ser corrigido no cadastro do WMS. O ajuste
  // manual continua valendo, mas só pra quem o usuário apontou de propósito.
  return (IR.transSetores||{})[l.x1] || '';
}
// Palpite inicial, a partir do que o próprio endereço diz. Serve pra tela nascer
// útil; o usuário corrige o que estiver errado e a correção fica salva.
/* Só o que o usuário mandou desconsiderar de propósito. O resto vem da classe
   local do WMS — palpite por prefixo colocava endereço no setor errado. */
const IR_TRANS_SEED = { GAI:'IGN' };
/* O palpite inicial evolui — GAI virou expedição depois que o usuário explicou o
   que ele é. Quando isso acontece, o mapa salvo precisa receber a correção sem
   atropelar o que o usuário classificou à mão: por isso as escolhas dele ficam
   numa lista separada, e o seed só sobrescreve prefixo que ele nunca tocou. */
const IR_TRANS_SEED_V = 3;
async function irSeedTransSetoresIfEmpty(){
  const salvo = await irGetConfig('transitorio-setores');
  if(!salvo){
    await irSetConfig('transitorio-setores', IR_TRANS_SEED);
    await irSetConfig('transitorio-setores-v', IR_TRANS_SEED_V);
    return Object.assign({}, IR_TRANS_SEED);
  }
  const versao = await irGetConfig('transitorio-setores-v');
  if(versao === IR_TRANS_SEED_V) return salvo;
  /* Recomeça do zero, mantendo só o que o usuário apontou de propósito. Merge
     simples não bastava: o palpite antigo por prefixo (RES em Controle de
     Estoque, TRI em Reversa...) continuava gravado e mandava endereço pro setor
     errado mesmo depois de a regra passar a ser a classe local do WMS. */
  const doUsuario = new Set(await irGetConfig('transitorio-setores-user') || []);
  const mapa = Object.assign({}, IR_TRANS_SEED);
  for(const pref in salvo) if(doUsuario.has(pref)) mapa[pref] = salvo[pref];
  await irSetConfig('transitorio-setores', mapa);
  await irSetConfig('transitorio-setores-v', IR_TRANS_SEED_V);
  return mapa;
}
async function irTransSetPrefixo(prefixo, setor){
  const mapa = Object.assign({}, IR.transSetores || {});
  if(setor) mapa[prefixo] = setor; else delete mapa[prefixo];
  IR.transSetores = mapa;
  const doUsuario = new Set(await irGetConfig('transitorio-setores-user') || []);
  doUsuario.add(prefixo);
  await irSetConfig('transitorio-setores-user', Array.from(doUsuario));
  await irSetConfig('transitorio-setores', mapa);
  irRenderView();
}
function irTransToggle(chave){ IR.transExpandido = IR.transExpandido===chave ? null : chave; irRenderView(); }
async function irCarregarEstoque390(){
  if(IR._est390Loading) return;
  IR._est390Loading = true;
  try{ IR.est390Locais = await irGetEstoqueLocais(); }
  catch(err){ IR.est390Locais = []; }
  finally{ IR._est390Loading = false; irRenderView(); }
}
/* Agrupa os endereços por setor. Só entra endereço com saldo — endereço vazio não
   é transitório, é endereço livre. */
function irTransCalc(){
  const mapa = IR.transSetores || {};
  const grupos = new Map();
  let valorTotal = 0, pecasTotal = 0, nLocais = 0;
  for(const l of (IR.est390Locais||[])){
    if(!l.qtd && !l.valor) continue;
    const setor = irTransSetorDe(l);
    if(!grupos.has(setor)) grupos.set(setor, {setor, valor:0, qtd:0, locais:[], prefixos:new Set()});
    const g = grupos.get(setor);
    g.valor += l.valor; g.qtd += l.qtd; g.locais.push(l); g.prefixos.add(irTransChave(l));
    if(setor==='IGN') continue; // desconsiderado não entra no total de transitório
    valorTotal += l.valor; pecasTotal += l.qtd; nLocais++;
  }
  for(const g of grupos.values()) g.locais.sort((a,b)=>b.valor-a.valor);
  // Transporte em penúltimo e Reversa por último: são os maiores volumes e os que
  // menos mudam de um dia pro outro, então empurram pra baixo o que precisa de decisão.
  const ordem = g => g.setor==='IGN' ? 4 : (!g.setor ? 3
    : (g.setor==='REV' ? 2 : (g.setor==='TRP' ? 1 : 0)));
  const lista = Array.from(grupos.values()).sort((a,b)=> ordem(a)-ordem(b) || b.valor-a.valor);
  return {lista, valorTotal, pecasTotal, nLocais};
}
/* Nome do transitório. O prefixo sozinho não diz nada pra quem lê o relatório —
   "CAN" é "pedidos cancelados". A lista nasce com os nomes que o próprio usuário
   já usa no relatório de pendência e cai no prefixo quando não conhece. */
const IR_TRANS_NOMES = {
  CAN:'PEDIDOS CANCELADOS', MOV:'MOVIMENTAÇÃO DE STK', REV:'MOV. REVERSA P/ ESTOQUE',
  AEE:'GANHOS P/ SEREM MOV.', TR:'TRANSITORIO', TRA:'TRANSITORIO', TRI:'TRANSITORIO',
  ANE:'ANE', ARI:'AJUSTE RECEBIMENTO', AVA:'AVARIA', DEV:'DEVOLUÇÃO', DS:'DESCARTE',
  QBR:'QUEBRA', BLO:'BLOQUEADO', LIT:'LITÍGIO', INV:'INVENTÁRIO', PAL:'PALLETS',
  EPI:'EPI', PIC:'PICKING REVERSA', BMS:'BMS REVERSA', RML:'REMANEJO', FAT:'FATURAMENTO',
  OUT:'EXPEDIÇÃO', GAI:'EXPEDIÇÃO', REC:'RECEBIMENTO', BUF:'BUFFER', ATI:'ATIVO',
  ROT:'ROTATIVO', INA:'INATIVO', MEZ:'MEZANINO', RES:'RESERVA', CAR:'CARGA'
};
/* O nome do transitório é editável: a lista de fábrica cobre o que apareceu no
   relatório do usuário, mas só quem opera sabe que SEG é seguro. O que ele digita
   fica salvo e vale por cima do padrão. */
/* Chave do transitório: X1 + X2. Só o X1 juntava numa linha coisas de finalidade
   diferente — "CAN SAC" e "CAN MCL" são os dois cancelamento, mas um é SAC e o
   outro MCL, e o saldo parado de cada um é cobrado de gente diferente. */
function irTransChave(l){
  const x1 = String(l.x1||'').trim(), x2 = String(l.x2||'').trim();
  return x2 ? x1+' '+x2 : x1;
}
/* Nome do transitório. Procura primeiro pela chave inteira ("CAN SAC"), depois
   pelo X1 sozinho — assim os nomes já cadastrados por prefixo continuam valendo
   pras duas linhas até alguém dar um nome específico a cada uma. */
function irTransNome(p){
  const chave = String(p||'').trim();
  const meu = (IR.transNomes||{})[chave];
  if(meu!=null && meu!=='') return meu;
  if(IR_TRANS_NOMES[chave]) return IR_TRANS_NOMES[chave];
  const x1 = chave.split(' ')[0];
  const meuX1 = (IR.transNomes||{})[x1];
  if(meuX1!=null && meuX1!=='') return meuX1;
  return IR_TRANS_NOMES[x1] || chave;
}
async function irTransSetNome(prefixo, nome){
  const mapa = Object.assign({}, IR.transNomes||{});
  const v = String(nome||'').trim();
  if(v) mapa[prefixo] = v; else delete mapa[prefixo];
  IR.transNomes = mapa;
  await irSetConfig('transitorio-nomes', mapa);
  irRenderView();
}
// Ordem fixa dos LOGs, pra tabela não trocar de coluna a cada importação.
const IR_TRANS_LOGS = ['LOG 1','LOG 2','LOG 3','LOG 4','LOG 5','LOG 6','EMBALAGEM','S/CAD'];
function irTransLogsPresentes(){
  const vistos = new Set();
  for(const l of (IR.est390Locais||[])) for(const k in (l.porLog||{})) if(l.porLog[k]) vistos.add(k);
  const conhecidos = IR_TRANS_LOGS.filter(x=>vistos.has(x));
  const outros = Array.from(vistos).filter(x=>!IR_TRANS_LOGS.includes(x)).sort();
  return conhecidos.concat(outros);
}
/* Faixas de idade do saldo, contadas do dia do último movimento até hoje. É a
   pendência de movimentação: D0 é o que entrou hoje e ainda pode sair sozinho;
   D+7 é acumulativo — sete dias OU MAIS. A faixa aberta "D+" que existia depois
   dele saía do gráfico e da tabela sem dizer de quantos dias estava falando, o
   que não serve pra cobrar responsável. Saldo sem data cai em D+7 pelo mesmo
   motivo: se ninguém sabe quando entrou, é caso de cobrança, não de folga. */
const IR_TRANS_FAIXAS = ['D0','D+1','D+2','D+3','D+4','D+5','D+6','D+7'];
const IR_TRANS_FAIXA_MAX = 7;
function irTransFaixa(dia, hoje){
  if(!dia) return 'D+'+IR_TRANS_FAIXA_MAX;
  const d = Math.round((hoje - Date.parse(dia+'T00:00:00')) / 86400000);
  if(d <= 0) return 'D0';
  if(d >= IR_TRANS_FAIXA_MAX) return 'D+'+IR_TRANS_FAIXA_MAX;
  return 'D+'+d;
}
/* Prazo do transitório: 48 horas. D0 e D+1 estão dentro; de D+2 em diante o saldo
   já passou do combinado. É o que separa verde de vermelho na tabela. */
const IR_TRANS_PRAZO_H = 48;
function irTransDentroDoPrazo(faixa){ return faixa==='D0' || faixa==='D+1'; }
// Peças E valor por faixa de idade de um endereço (ou de um grupo de endereços).
function irTransIdade(locais){
  const hoje = Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00');
  const r = {}, v = {}; let comData = 0;
  for(const f of IR_TRANS_FAIXAS){ r[f] = 0; v[f] = 0; }
  for(const l of locais){
    const pd = l.porDia, pv = l.porDiaValor || {};
    if(pd && Object.keys(pd).length){
      for(const dia in pd){
        const f = irTransFaixa(dia, hoje);
        r[f] += pd[dia]; v[f] += (pv[dia]||0); comData += pd[dia];
      }
    }
  }
  return {faixas:r, valores:v, comData};
}
/* Barrinhas de valor acumulado por idade, acima de cada tabela. A pergunta é
   "quanto dinheiro está represado em cada faixa" — e a resposta em barra se lê
   antes da tabela, que é onde estão os detalhes. */
function irTransTemData(){
  return (IR.est390Meta||{}).fonte === '160';
}
/* Quanto do saldo parado em transitório é ganho do NET.

   O ANE é endereço de "não localizado": quando o assistente não acha a peça, ele
   move o saldo pra lá. Se depois a peça aparece em outro endereço, o inventário
   registra GANHO — e o saldo do ANE continua parado, representando um ganho que
   já foi contabilizado. É o caso de mandar movimentar em vez de sair procurando. */
async function irTransCarregarGanhos(){
  if(IR._transGanhos || IR._transGanhosLoading) return;
  IR._transGanhosLoading = true;
  try{
    // O NET do ano vem da QRY410 — é o livro fiscal, tem todo ajuste do CD, e é a
    // base que a operação usa pra falar de ganho. Só item com saldo POSITIVO entra:
    // item que perdeu no ano não tem duplicidade pra explicar.
    const ano = String(new Date().getFullYear());
    let dados = (IR.div410Cache||{})[ano];
    if(!dados){ dados = await irGetNet410(Number(ano)); IR.div410Cache = Object.assign({}, IR.div410Cache||{}, {[ano]:dados||{vazio:true}}); }
    const porItem = new Map();
    for(const linha of ((dados||{}).porMes || [])){
      for(const i of (linha.topItensPositivos||[]).concat(linha.topItensNegativos||[])){
        const k = irDivNormItem(i.item);
        if(!k) continue;
        porItem.set(k, (porItem.get(k)||0) + (i.saldoQtd||0));
      }
    }
    IR._transGanhos = new Map(Array.from(porItem.entries()).filter(([,q])=>q>0));
    IR._transGanhosAno = ano;
    // Diagnóstico: sem isso, "prov. duplicidade" zerada é indistinguível de
    // "não tem duplicidade" — e o motivo quase sempre é a QRY410 não importada.
    IR._transGanhosDiag = {
      ano, tem410: !!(dados && !dados.vazio && (dados.porMes||[]).length),
      itens410: porItem.size, comGanho: IR._transGanhos.size
    };
  }catch(err){ IR._transGanhos = new Map(); IR._transGanhosDiag = {erro:String(err)}; }
  finally{ IR._transGanhosLoading = false; irRenderView(); }
}
// local -> {qtd, valor} do saldo que pertence a item com ganho no ano.
function irTransGanhoPorLocal(){
  if(IR._transGanhoLocal) return IR._transGanhoLocal;
  const m = new Map();
  const ganhos = IR._transGanhos;
  if(ganhos && ganhos.size && IR._itemInfo){
    // Só endereço de transitório entra no rateio. A ficha da 390 traz TODOS os
    // endereços do item, ordenados do maior saldo pro menor, e o rateio gastava o
    // ganho do ano nos endereços de picking — que vêm primeiro e são bem maiores —
    // antes de chegar no ANE/CAN da vez. Era por isso que a coluna vinha zerada
    // mesmo com a QRY410 importada: a pergunta aqui é quanto do ganho PODE estar
    // parado num transitório, então o transitório é quem atende primeiro.
    const transitorios = new Set();
    for(const g of irTransCalc().lista){
      if(!g.setor || g.setor==='IGN') continue;
      for(const l of g.locais) transitorios.add(l.local);
    }
    // Contadores do cruzamento. Uma coluna zerada tem quatro causas possíveis e
    // cada uma se resolve de um jeito; sem medir onde a corrente arrebenta, a
    // única saída é chutar qual base reimportar.
    const d = IR._transGanhosDiag = IR._transGanhosDiag || {};
    d.locaisTransitorios = transitorios.size;
    d.fichas390 = IR._itemInfo.size;
    d.comFicha = 0; d.comEndereco = 0; d.comTransitorio = 0;
    for(const [item, ganhoQtd] of ganhos){
      const info = IR._itemInfo.get(irDivNormItem(item));
      if(!info || !info.locais) continue;
      d.comFicha++;
      if(info.locais.length) d.comEndereco++;
      if(info.locais.some(l=>transitorios.has(l.local))) d.comTransitorio++;
      const preco = info.valorUnitario || 0;
      // A duplicidade não pode ser maior que o ganho do ano nem que o saldo do
      // endereço: o excedente é estoque legítimo, não sobra duplicada.
      let restante = ganhoQtd;
      for(const l of info.locais){
        if(restante <= 0) break;
        if(!transitorios.has(l.local)) continue;
        const q = Math.min(l.qtd, restante);
        restante -= q;
        if(!m.has(l.local)) m.set(l.local, {qtd:0, valor:0});
        const g = m.get(l.local);
        g.qtd += q; g.valor += q * preco;
      }
    }
  }
  IR._transGanhoLocal = m;
  return m;
}
/* Três leituras lado a lado, pequenas.

   Duas linhas — peças e valor — porque a mesma faixa pode ter muita peça barata
   ou pouca peça cara, e a decisão muda. Cada uma na sua escala; comparar as duas
   num eixo só achataria a de menor magnitude.

   E uma rosca com o valor dentro e fora do prazo de 48h, que é a leitura de
   gestão: quanto do dinheiro parado já estourou o combinado. */
/* Cores literais pros SVGs. Dentro de um data: URI (que é como o gráfico vira
   imagem pro boletim) não existe var() nem folha de estilo — o que não for
   literal simplesmente não pinta. */
function irCorTema(nome, padrao){
  try{
    const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || padrao;
  }catch(err){ return padrao; }
}
function irPaletaSVG(){
  return {
    blue: irCorTema('--blue', '#001A72'),
    orange: irCorTema('--orange', '#FA4616'),
    success: irCorTema('--success', '#1F8A52'),
    ink: irCorTema('--ink', '#1D1F2A'),
    inkSoft: irCorTema('--ink-soft', '#6B7280'),
    line: irCorTema('--line', '#D5D8E0'),
    surface2: irCorTema('--surface2', '#EEF0F4')
  };
}
const IR_SVG_FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
/* Curva suave (Catmull-Rom convertido em bézier cúbica) em vez de segmentos retos.
   Os pontos de controle são grampeados na faixa do plot: sem isso um pico isolado
   como o D+7 faz a curva estourar pra fora do card. */
function irTransCurva(pts, yMin, yMax){
  if(pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  const cl = v => Math.min(yMax, Math.max(yMin, v));
  const T = 0.85;
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for(let i=0;i<pts.length-1;i++){
    const p0 = pts[i-1] || pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2] || p2;
    const c1x = p1[0] + (p2[0]-p0[0])/6*T, c1y = cl(p1[1] + (p2[1]-p0[1])/6*T);
    const c2x = p2[0] - (p3[0]-p1[0])/6*T, c2y = cl(p2[1] - (p3[1]-p1[1])/6*T);
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
/* O viewBox tem proporção fixa e o SVG escala junto (height:auto no CSS). O
   preserveAspectRatio="none" que estava aqui esticava traço e texto na horizontal
   — era isso que dava o aspecto borrado. */
function irTransLinha(vals, titulo, total, fmt, cor, fmtCurto){
  const W = 368, H = 128, padL = 16, padR = 16, padT = 32, padB = 21;
  const P = irPaletaSVG();
  const tinta = cor === 'blue' ? P.blue : P.orange;
  const passo = (W - padL - padR) / Math.max(1, vals.length - 1);
  const base = H - padB;
  /* Escala logarítmica, e não linear. Um dia costuma concentrar quase tudo
     (48.310 peças no D+7 contra 173 no D+1, 279 vezes mais): no linear os outros
     dias viravam 0,4% da altura e a linha sumia dentro do eixo — sete dos oito
     pontos encostados nele. O log põe as ordens de grandeza na mesma tela e
     preserva a ordem e o pico; a altura passa a dizer "qual dia tem massa
     parada", e o quanto exato continua escrito no próprio ponto e na tabela.
     log1p em vez de log porque dia zerado é comum aqui e log(0) não existe.
     O piso tira a curva de cima do eixo: dia zerado desenha logo acima dele, em
     vez de se confundir com a própria linha de base. */
  const esc = v => Math.log1p(Math.max(0, v||0));
  const maxE = Math.max(...vals.map(esc), 1);
  const piso = 7;
  const y = v => padT + (base - piso - padT) * (1 - esc(v)/maxE);
  const pts = vals.map((v,i)=>[padL + i*passo, y(v)]);
  const linha = irTransCurva(pts, padT - 4, base);
  const area = linha + ` L${pts[pts.length-1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z`;
  const iMax = vals.indexOf(Math.max(...vals));
  const gid = 'tgg' + Math.random().toString(36).slice(2,8);
  return `<div class="tg-card">
    <div class="tg-head"><span>${irEsc(titulo)}</span><strong>${irEsc(total)}</strong></div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="tg-svg" shape-rendering="geometricPrecision"
      font-family="${IR_SVG_FONTE}" role="img" aria-label="${irEsc(titulo)}: ${irEsc(total)}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${tinta}" stop-opacity=".28"/>
        <stop offset="1" stop-color="${tinta}" stop-opacity="0"/>
      </linearGradient></defs>
      <line x1="${padL-6}" y1="${base}" x2="${W-padL+6}" y2="${base}" stroke="${P.line}" stroke-width="1.2"/>
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${linha}" fill="none" stroke="${tinta}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i===iMax?4.6:3.2}"
        fill="${irTransDentroDoPrazo(IR_TRANS_FAIXAS[i])?P.success:P.orange}" stroke="${P.surface2}" stroke-width="1.4"><title>${irEsc(IR_TRANS_FAIXAS[i])}: ${irEsc(fmt(vals[i]))}</title></circle>`).join('')}
      ${pts.map((p,i)=>{
        if(!(vals[i]>0)) return '';
        // O máximo leva o valor cheio; os demais vão compactos, senão os rótulos
        // se sobrepõem — são oito dias em pouco mais de 300px de viewBox.
        const cheio = i===iMax;
        const txt = cheio ? fmt(vals[i]) : fmtCurto(vals[i]);
        const fs = cheio ? 10 : 8;
        // Largura estimada do texto (o SVG não mede antes de desenhar): metade
        // dela é o quanto o rótulo precisa de folga de cada lado pra não vazar
        // do card — foi o que aconteceu com o valor cheio no D+7.
        const meia = txt.length * fs * 0.30;
        // Um pico vizinho passa por cima do rótulo. Empurra pro lado contrário
        // à subida antes de grampear na caixa.
        const sobe = (j) => pts[j] && pts[j][1] < p[1] - 14;
        let x = p[0] + (sobe(i+1) ? -7 : (sobe(i-1) ? 7 : 0));
        x = Math.min(W - meia - 1, Math.max(meia + 1, x));
        const yTxt = Math.max(fs + 2, p[1] - (cheio ? 11 : 8));
        return `<text x="${x.toFixed(1)}" y="${yTxt.toFixed(1)}" font-size="${fs}" font-weight="800"
          fill="${cheio?P.ink:P.inkSoft}" text-anchor="middle">${irEsc(txt)}</text>`;
      }).join('')}
      ${pts.map((p,i)=>`<text x="${p[0].toFixed(1)}" y="${H-6}" font-size="9" font-weight="800"
        fill="${irTransDentroDoPrazo(IR_TRANS_FAIXAS[i])?P.success:P.orange}" text-anchor="middle">${irEsc(IR_TRANS_FAIXAS[i].replace('D+','+').replace('D0','0'))}</text>`).join('')}
    </svg>
  </div>`;
}
/* Compacto sem casa decimal: no rótulo dentro do anel e na legenda o centavo não
   decide nada, e "R$20,1K" só rouba espaço de fonte. */
/* Valor da célula da tabela de transitórios, por extenso e com centavos — o
   mesmo formato da coluna "valor por endereço". Compacto (R$10,6K) arredondava
   demais pra quem usa a tabela pra cobrar o responsável pelo saldo. As colunas
   de dia foram alargadas pra caber. */
function irTransValorCel(n){
  return irFmtMoney(n||0);
}
function irTransNumCurto(n){
  n = n||0;
  return Math.abs(n)>=10000 ? Math.round(n/1000).toLocaleString('pt-BR')+'K' : irFmtInt(n);
}
function irTransValorCurto(n){
  n = n||0;
  const abs = Math.abs(n);
  if(abs>=1000000) return 'R$'+Math.round(n/1000000).toLocaleString('pt-BR')+'M';
  if(abs>=1000) return 'R$'+Math.round(n/1000).toLocaleString('pt-BR')+'K';
  return 'R$'+Math.round(n).toLocaleString('pt-BR');
}
/* Rosca nas cores da casa: azul o que está no prazo, laranja o que estourou.
   Rótulo de dados em cada fatia (o percentual, inteiro). O miolo fica vazio: o
   total já está no KPI do topo do painel, e repetido ali só apertava o anel. */
function irTransRosca(dentro, fora){
  const total = dentro + fora;
  if(total <= 0) return '';
  const P = irPaletaSVG();
  const cx = 84, R = 60, C = 2*Math.PI*R, larg = 44, pctFora = fora/total;
  const pctTxt = p => Math.round(p*100)+'%';
  // Rótulo no meio da banda da fatia. A laranja começa às 12h e cresce no sentido
  // horário; a azul ocupa o que sobra.
  const rot = (pct, inicio) => {
    if(pct < .08) return '';                        // fatia fina: o texto não caberia
    const ang = (inicio + pct/2) * 2*Math.PI - Math.PI/2;
    return `<text x="${(cx + R*Math.cos(ang)).toFixed(1)}" y="${(cx + R*Math.sin(ang)).toFixed(1)}"
      font-size="15" font-weight="800" fill="#fff" text-anchor="middle"
      dominant-baseline="central">${pctTxt(pct)}</text>`;
  };
  return `<div class="tg-card tg-card-rosca">
    <div class="tg-head"><span>Prazo de ${IR_TRANS_PRAZO_H}h</span><strong class="${pctFora>0?'atraso':''}">${pctTxt(pctFora)} fora</strong></div>
    <div class="tg-rosca">
      <svg viewBox="0 0 ${cx*2} ${cx*2}" width="${cx*2}" height="${cx*2}" shape-rendering="geometricPrecision"
        font-family="${IR_SVG_FONTE}" role="img" aria-label="${pctTxt(pctFora)} do valor fora do prazo">
        <circle cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="${P.blue}" stroke-width="${larg}"/>
        <circle cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="${P.orange}" stroke-width="${larg}"
          stroke-dasharray="${(C*pctFora).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})"/>
        ${rot(pctFora, 0)}
        ${rot(1-pctFora, pctFora)}
      </svg>
      <ul class="tg-leg">
        <li><span><i class="prazo"></i>No prazo</span><b>${irEsc(irTransValorCurto(dentro))}</b></li>
        <li><span><i class="atraso"></i>Fora</span><b class="atraso">${irEsc(irTransValorCurto(fora))}</b></li>
      </ul>
    </div>
  </div>`;
}
/* Por que a duplicidade deu zero. São três motivos possíveis e cada um tem uma
   ação diferente — dizer só "nada a movimentar" mandaria o usuário procurar bug
   onde só falta importar uma planilha. */
function irTransDiagDuplicidade(){
  const d = IR._transGanhosDiag || {};
  if(d.erro) return 'erro ao ler a QRY410: '+d.erro;
  if(!d.tem410) return 'importe a QRY410 de '+(d.ano||'')+' na aba Importação';
  if(!d.comGanho) return 'nenhum item com ganho no NET de '+(d.ano||'')+' ('+(d.itens410||0)+' itens na 410)';
  if(!d.fichas390) return 'importe a QRY0390: é a única base que diz em que endereço o item está';
  if(!d.comFicha) return 'nenhum dos '+d.comGanho+' itens com ganho está na QRY0390 — reimporte a 390 (ela é do dia)';
  if(!d.comEndereco) return 'os '+d.comFicha+' itens com ganho não têm saldo em nenhum endereço do CD';
  if(!d.comTransitorio) return 'os '+d.comFicha+' itens com ganho têm saldo no CD, mas nenhum em transitório';
  return 'nada a movimentar';
}
function irTransGraficos(porFaixaQtd, porFaixaValor){
  const qs = IR_TRANS_FAIXAS.map(f=>porFaixaQtd[f]||0);
  const vs = IR_TRANS_FAIXAS.map(f=>porFaixaValor[f]||0);
  const totQ = qs.reduce((a,b)=>a+b,0), totV = vs.reduce((a,b)=>a+b,0);
  if(totQ<=0 && totV<=0) return '';
  let dentro=0, fora=0;
  IR_TRANS_FAIXAS.forEach((f,i)=>{ if(irTransDentroDoPrazo(f)) dentro += vs[i]; else fora += vs[i]; });
  return `<div class="tg-wrap">
    ${irTransLinha(qs, 'Peças por idade', irFmtInt(totQ), irFmtInt, 'blue', irTransNumCurto)}
    ${irTransLinha(vs, 'Valor por idade', irFmtMoney(totV), irFmtMoney, 'orange', irTransValorCurto)}
    ${irTransRosca(dentro, fora)}
  </div>`;
}
function irRenderTransitorios(){
  if(!IR.est390Locais){ irCarregarEstoque390(); return irDivCarregando(); }
  if(!IR._itemInfo){ irCarregarItemInfo().then(()=>irRenderView()); return irDivCarregando(); }
  if(!IR._transGanhos){ irTransCarregarGanhos(); return irDivCarregando(); }
  if(!IR.est390Locais.length){
    return irEmptyState('Sem estoque importado',
      'Importe a QRY0390 (ficha dos itens) e depois a QRY0160 (saldo com data de movimento) na aba Importação.',
      "irSwitchTab('importacao')", 'Ir para Importação');
  }
  const c = irTransCalc();
  const m = IR.est390Meta || {};
  const logs = irTransLogsPresentes();
  const naoClass = c.lista.find(g=>!g.setor);
  return `
    <div class="ofe-head" style="margin-bottom:4px;">
      <h3 style="margin:0;">Transitórios</h3>
      <button class="btn btn-primary" onclick="irBaixarBoletimTransitorios()">✉️ Reportar por e-mail</button>
    </div>
    ${irRenderTransEmailForm()}
    ${c.lista.filter(g=>g.setor && g.setor!=='IGN').map(g=>irTransPainelSetor(g, logs)).join('')}
    ${naoClass ? `<div class="panel"><div class="ofe-head">
      <h3>Não classificado</h3>
      <span class="field-hint">${irFmtMoney(naoClass.valor)} · ${irFmtInt(naoClass.locais.length)} endereços · ${irFmtInt(naoClass.prefixos.size)} transitórios. ${
        // A classe local não vem na QRY0160: ela é lida da QRY0390 e casada pelo
        // endereço. Endereço que a 390 não trouxe fica sem classe e cai aqui — a
        // causa mais comum é 390 desatualizada, não cadastro errado no WMS. Sem
        // dizer isso, o usuário vai procurar no lugar errado.
        m.fonte==='160' && m.semClasse
          ? 'A classe local vem da QRY0390, não da QRY0160: '+irFmtInt(m.semClasse)+' endereço(s) da 160 não foram encontrados na 390 importada. Reimportar a QRY0390 atualizada costuma resolver.'
          : 'Cadastre a classe local (TSF, C.E, INB, OUT, TRP, REV) no WMS e eles entram sozinhos; até lá, dá pra apontar o setor aqui.'
      }</span>
    </div>${irTransTabelaPrefixos(naoClass)}</div>` : ''}
    <p class="field-hint">Estoque de ${irEsc(m.importadoEm ? new Date(m.importadoEm).toLocaleString('pt-BR') : '—')} · ${irFmtInt(m.locais||0)} endereços no CD · ${irFmtMoney(m.valorTotal||0)} no total.
    ${irTransTemData() ? 'Idade do saldo contada da Data Movimento da QRY0160 até hoje.' : 'Importe a QRY0160 na aba Importação para abrir as colunas por idade do saldo — a QRY0390 não traz data de movimento.'}</p>
  `;
}
/* Uma tabela por setor, no formato do relatório de pendência: uma linha por
   transitório, peças abertas por LOG e o valor parado no endereço. */
function irTransPainelSetor(g, logs, estatico){
  const porPrefixo = new Map();
  for(const l of g.locais){
    const chave = irTransChave(l);
    if(!porPrefixo.has(chave)) porPrefixo.set(chave, {x1:chave, valor:0, qtd:0, n:0, itens:0, porLog:{}, locais:[], ganhoValor:0, ganhoQtd:0});
    const p = porPrefixo.get(chave);
    p.valor += l.valor; p.qtd += l.qtd; p.n++; p.itens += l.itens||0; p.locais.push(l);
    const gl = irTransGanhoPorLocal().get(l.local);
    if(gl){ p.ganhoValor += gl.valor; p.ganhoQtd += gl.qtd; }
    for(const k in (l.porLog||{})) p.porLog[k] = (p.porLog[k]||0) + l.porLog[k];
  }
  const linhas = Array.from(porPrefixo.values()).sort((a,b)=>b.valor-a.valor);
  // Com a QRY0160 importada a tabela abre por IDADE do saldo, que é a pergunta do
  // relatório de pendência; sem ela, cai pro LOG, que é o que a 390 sabe dizer.
  const comData = irTransTemData();
  const cols = IR_TRANS_FAIXAS;
  const totValFaixa = {};
  for(const p of linhas){
    const id = irTransIdade(p.locais);
    p.cel = id.faixas; p.celValor = id.valores;
    for(const f of cols) totValFaixa[f] = (totValFaixa[f]||0) + (id.valores[f]||0);
  }
  const totCol = {};
  for(const p of linhas) for(const k in p.cel) totCol[k] = (totCol[k]||0) + p.cel[k];
  const itens = linhas.reduce((s,p)=>s+p.itens,0);
  const ganhoSetor = linhas.reduce((s,p)=>s+p.ganhoValor,0);
  const cell = (rot, val, sub, classe) => `<div class="ofe-num${classe?' '+classe:''}">
    <span class="ofe-num-lbl">${irEsc(rot)}</span><strong class="mono">${val}</strong>
    ${sub?`<span class="ofe-num-sub">${irEsc(sub)}</span>`:''}</div>`;
  return `<div class="panel">
    <div class="ofe-head">
      <h3>${irEsc(IR_TRANS_SETOR_NOME[g.setor]||g.setor)}</h3>
    </div>
    <div class="ofe-resumo trans-kpis">
      ${cell('Parado', irFmtMoney(g.valor), irFmtInt(g.qtd)+' peças')}
      ${cell('Endereços', irFmtInt(g.locais.length), irFmtInt(linhas.length)+(linhas.length===1?' transitório':' transitórios'))}
      ${cell('Itens', irFmtInt(itens), 'distintos por endereço')}
      ${cell('Provável duplicidade', ganhoSetor>0?irFmtMoney(ganhoSetor):'—',
        ganhoSetor>0 ? irFmtPct(g.valor?ganhoSetor/g.valor:0)+' do saldo · ganho no NET do ano' : irTransDiagDuplicidade(),
        ganhoSetor>0 ? 'trans-kpi-dup' : '')}
    </div>
    ${irTransGraficos(totCol, totValFaixa)}
    <div class="table-wrap"><table class="trans-table">
      <thead>
        <tr><th rowspan="2" class="tt-local">Local transitório</th><th rowspan="2" class="tt-desc">Descrição</th>
            <th colspan="${cols.length}">Peças paradas há — prazo de ${IR_TRANS_PRAZO_H}h</th>
            <th rowspan="2" class="num tt-valor">Valor por endereço</th>
            <th rowspan="2" class="num tt-dup">Prov. duplicidade</th></tr>
        <tr>${cols.map(l=>`<th class="num tt-dia ${irTransDentroDoPrazo(l)?'tg-th-ok':'tg-th-atraso'}">${irEsc(l)}</th>`).join('')}</tr>
      </thead>
      <tbody>${linhas.map(p=>`<tr>
        <td class="mono">${irEsc(p.x1||'(vazio)')}</td>
        <td>${estatico ? irEsc(irTransNome(p.x1))
          : `<input class="trans-nome" value="${irEsc(irTransNome(p.x1))}" title="Nome do transitório — dá pra editar"
             onchange="irTransSetNome('${irEsc(p.x1)}', this.value)">`}</td>
        ${cols.map(l=>`<td class="mono tt-c-dia ${p.cel[l]?(irTransDentroDoPrazo(l)?'trans-ok':'trans-atraso'):''}">${
          p.cel[l] ? irFmtInt(p.cel[l])+'<span class="trans-cel-val">'+irTransValorCel(p.celValor[l]||0)+'</span>' : '0'}</td>`).join('')}
        <td class="mono tt-c-num">${irFmtMoney(p.valor)}</td>
        <td class="mono tt-c-num ${p.ganhoValor>0?'trans-ganho':''}" title="Saldo que pode estar duplicado: item com ganho no NET do ano da QRY410 e saldo parado aqui">${
          p.ganhoValor>0 ? irFmtMoney(p.ganhoValor)+'<span class="trans-pct">'+irFmtPct(p.valor?p.ganhoValor/p.valor:0)+'</span>' : '—'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr>
        <td colspan="2"><strong>Total</strong></td>
        ${cols.map(l=>`<td class="mono tt-c-dia"><strong>${totCol[l]?irFmtInt(totCol[l]):'0'}</strong>${
          totCol[l]?'<span class="trans-cel-val">'+irTransValorCel(totValFaixa[l]||0)+'</span>':''}</td>`).join('')}
        <td class="mono tt-c-num"><strong>${irFmtMoney(g.valor)}</strong></td>
        <td class="mono tt-c-num"><strong>${ganhoSetor>0?irFmtMoney(ganhoSetor):'—'}</strong></td>
      </tr></tfoot>
    </table></div>
  </div>`;
}
/* Os prefixos sem setor, com o botão de classificar em cada linha. É por aqui que
   o mapa vai sendo corrigido, sem menu de configuração separado. */
function irTransTabelaPrefixos(g){
  const porPrefixo = new Map();
  for(const l of g.locais){
    const chave = irTransChave(l);
    if(!porPrefixo.has(chave)) porPrefixo.set(chave, {x1:chave, prefixo:l.x1, valor:0, qtd:0, n:0, ex:l.desc, clal:new Set()});
    const p = porPrefixo.get(chave); p.valor += l.valor; p.qtd += l.qtd; p.n++;
    if(l.clal) p.clal.add(l.clal);
  }
  const lista = Array.from(porPrefixo.values()).sort((a,b)=>b.valor-a.valor);
  return `<div class="table-wrap"><div class="table-scroll" style="max-height:420px;">
    <table class="conc-table">
      <thead><tr><th>Local transitório</th><th>Exemplo</th><th>Classe no WMS</th><th class="num">Endereços</th><th class="num">Peças</th><th class="num">Valor</th><th>Setor</th></tr></thead>
      <tbody>${lista.map(p=>`<tr>
        <td class="mono">${irEsc(p.x1||'(vazio)')}</td>
        <td>${irEsc(p.ex||'')}</td>
        <td class="mono">${irEsc(Array.from(p.clal||[]).join(', ') || '—')}</td>
        <td class="mono">${irFmtInt(p.n)}</td>
        <td class="mono">${irFmtInt(p.qtd)}</td>
        <td class="mono">${irFmtMoney(p.valor)}</td>
        <td><select onchange="irTransSetPrefixo('${irEsc(p.prefixo||p.x1)}', this.value)">
          <option value="">—</option>
          ${IR_TRANS_SETORES.map(x=>`<option value="${x}">${irEsc(IR_TRANS_SETOR_NOME[x]||x)}</option>`).join('')}
        </select></td>
      </tr>`).join('')}</tbody>
    </table>
  </div></div>`;
}
/* Boletim em imagem pros gestores: é o MESMO painel da tela, reaproveitado por
   setor, e não uma segunda montagem parecida. Duas montagens é como o boletim
   ficou pra trás dos ajustes do dash — gráfico empilhado, tabela com outra grade.
   Aqui a única diferença é o nome do transitório sair como texto no lugar do
   campo editável, que numa imagem viraria uma caixa de formulário. */
/* Destinatários do report de transitórios. Ficam salvos porque o pedido é não
   redigitar os responsáveis todo dia — e o assunto é FIXO de propósito: o
   Outlook agrupa conversa por assunto, então repetir o mesmo texto faz o report
   de hoje cair na mesma thread do de ontem. Botar a data no assunto quebraria
   isso, por isso ela vai no corpo. */
const IR_TRANS_EMAIL_ASSUNTO = 'Transitórios — Pendência de Movimentação';
function irTransEmailCfg(){
  const c = IR.transEmail || {};
  return {para: c.para||'', cc: c.cc||'', assunto: c.assunto || IR_TRANS_EMAIL_ASSUNTO};
}
async function irTransSetEmail(campo, valor){
  IR.transEmail = Object.assign({}, irTransEmailCfg(), {[campo]: (valor||'').trim()});
  await irSetConfig('transitorio-email', IR.transEmail);
  irRenderView();
}
function irTransToggleDestinatarios(){
  IR.transEmailAberto = !IR.transEmailAberto;
  irRenderView();
}
/* Corpo do e-mail: os mesmos números da tela, em texto. A imagem depende de
   anexar à mão, então o e-mail precisa se sustentar sem ela. */
function irTransCorpoEmail(){
  const c = irTransCalc();
  const m = IR.est390Meta || {};
  const hoje = new Date().toLocaleDateString('pt-BR');
  const linhas = [`Transitórios — ${hoje}`, ''];
  let dentro = 0, fora = 0;
  const setores = c.lista.filter(g=>g.setor && g.setor!=='IGN');
  for(const g of setores){
    const id = irTransIdade(g.locais);
    let d = 0, f = 0;
    for(const faixa of IR_TRANS_FAIXAS){
      if(irTransDentroDoPrazo(faixa)) d += id.valores[faixa]||0; else f += id.valores[faixa]||0;
    }
    dentro += d; fora += f;
    const pct = (d+f) > 0 ? Math.round(f/(d+f)*100) : 0;
    linhas.push(`${IR_TRANS_SETOR_NOME[g.setor]||g.setor}: ${irFmtMoney(g.valor)} · ${irFmtInt(g.qtd)} pç · ${pct}% fora do prazo`);
  }
  const total = dentro + fora;
  linhas.push('');
  linhas.push(`Total parado: ${irFmtMoney(c.valorTotal)} · ${irFmtInt(c.pecasTotal)} peças · ${irFmtInt(c.nLocais)} endereços`);
  if(total > 0) linhas.push(`Fora do prazo de ${IR_TRANS_PRAZO_H}h: ${irFmtMoney(fora)} (${Math.round(fora/total*100)}%)`);
  const dup = irTransGanhoPorLocal();
  let vDup = 0; for(const [,g] of dup) vDup += g.valor;
  if(vDup > 0) linhas.push(`Provável duplicidade: ${irFmtMoney(vDup)}`);
  if(m.importadoEm) linhas.push(`\nEstoque de ${new Date(m.importadoEm).toLocaleString('pt-BR')}.`);
  return linhas.join('\n');
}
function irRenderTransEmailForm(){
  const c = irTransEmailCfg();
  if(!IR.transEmailAberto){
    const quem = c.para ? c.para.split(/[,;]/).filter(Boolean).length + ' destinatário(s)' : 'nenhum destinatário';
    return `<p class="field-hint trans-dest"><strong>${irEsc(quem)}</strong>
      <button class="btn-link" onclick="irTransToggleDestinatarios()">${c.para?'alterar':'definir'}</button></p>`;
  }
  return `<div class="trans-dest-form">
    <div><label>Para</label><input type="text" value="${irEsc(c.para)}" placeholder="fulano@lojadomecanico.com.br; ciclano@..."
      onchange="irTransSetEmail('para', this.value)"></div>
    <div><label>Em cópia</label><input type="text" value="${irEsc(c.cc)}" placeholder="gestores@..."
      onchange="irTransSetEmail('cc', this.value)"></div>
    <div><label>Assunto (fixo — é o que junta os e-mails na mesma conversa)</label>
      <input type="text" value="${irEsc(c.assunto)}" onchange="irTransSetEmail('assunto', this.value)"></div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="irTransToggleDestinatarios()">Fechar</button></div>
  </div>`;
}
async function irBaixarBoletimTransitorios(){
  const c = irTransCalc();
  const m = IR.est390Meta || {};
  const logs = irTransLogsPresentes();
  const setores = c.lista.filter(g=>g.setor && g.setor!=='IGN');
  const html = `<div class="rp-page rp-page-wide">
    <div class="rp-hero">
      <div class="rp-hero-top">
        <img src="brand/Logo_LDM_hor_branco.png" alt="Loja do Mecânico" class="rp-hero-logo">
        <div class="rp-hero-status">${irEsc(m.importadoEm ? new Date(m.importadoEm).toLocaleDateString('pt-BR') : '')}</div>
      </div>
      <div class="rp-hero-badge">Pendência de Movimentação</div>
      <h1>Transitórios por setor</h1>
      <p>Loja do Mecânico · Centro de Distribuição Cajamar</p>
      <div class="rp-hero-meta"><span>${irFmtMoney(c.valorTotal)} parados · ${irFmtInt(c.pecasTotal)} peças · ${irFmtInt(c.nLocais)} endereços</span></div>
    </div>
    <div class="rp-body">
      ${/* Só os setores da legenda (TSF, C.E, INB, OUT, TRP, REV). O endereço sem
            classe não entra: "sem classe" aqui é o CD inteiro — picking, pulmão,
            armazenagem normal —, dezenas de milhares de endereços que não são
            transitório e afogariam o relatório. Ele continua visível na tela,
            que é onde se resolve o cadastro. */''}
      ${setores.map(g=>irTransPainelSetor(g, logs, true)).join('')}
      <p class="rp-footer">Prazo do transitório: ${IR_TRANS_PRAZO_H}h — verde está no prazo, laranja passou. D+${IR_TRANS_FAIXA_MAX} é acumulativo: sete dias ou mais.<br>"Prov. duplicidade" é o saldo de itens que fecharam o ano com ganho no NET da QRY410 — movimentar resolve, procurar não.<br>Estoque de ${irEsc(m.importadoEm ? new Date(m.importadoEm).toLocaleString('pt-BR') : '—')} · Controle de Transitórios.</p>
    </div>
  </div>`;
  irBaixarBoletimImagem(html, 'Transitorios_'+new Date().toISOString().slice(0,10)+'.png',
    Object.assign({}, irTransEmailCfg(), {corpo: irTransCorpoEmail()}));
}


/* ============================================================
   SHELL
   ============================================================
   Uma tela só: não há aba pra trocar. O que existia de navegação no Inventário
   (ciclo ativo, filtro de mês, troca de aba) não faz sentido aqui — transitório
   não é do ciclo, é do estoque de agora. */
function irRenderView(){
  const raiz = document.getElementById('viewRoot');
  if(!raiz) return;
  raiz.innerHTML = IR.initErro
    ? irEmptyState('Não consegui abrir o banco do navegador', IR.initErro, null, null)
    : irRenderTransitorios();
}
/* A tela de transitórios oferece "ir importar" quando não há estoque carregado.
   Quem importa a QRY0390 é o Inventário, então o botão leva pra lá em vez de
   trocar de aba — aqui não existe aba pra trocar. */
function irSwitchTab(){ location.href = '../inventario-rotativo/'; }
async function irInit(){
  const temaSalvo = localStorage.getItem('ir-theme');
  if(temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  const temaApp = localStorage.getItem('ir-app-theme');
  if(temaApp && temaApp!=='padrao') document.documentElement.setAttribute('data-app-theme', temaApp);
  irUpdateThemeLabel();
  irApplyZoom(parseInt(localStorage.getItem('ir-zoom'), 10) || 100);
  const versao = document.getElementById('sidebarVersao');
  if(versao) versao.textContent = IR_APP_VERSION;
  try{
    IR.est390Meta = await irGetEstoqueMeta();
    IR.transSetores = await irSeedTransSetoresIfEmpty();
    IR.transNomes = await irGetConfig('transitorio-nomes') || {};
    IR.transEmail = await irGetConfig('transitorio-email');
  }catch(e){
    console.error('Falha ao iniciar', e);
    IR.initErro = (e && (e.name ? e.name+': '+e.message : e.message)) || String(e);
  }
  irRenderView();
}
