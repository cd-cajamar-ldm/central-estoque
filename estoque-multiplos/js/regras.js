/* ============================================================
   Estoque de Múltiplos — regras (usado pelo worker e pelos testes)
   ============================================================
   De onde vem cada coisa:
   - ZBIQ0051: a estrutura. Cada linha liga um item pai (item_vol_multiplo) a
     um componente (item_componente). in_interface = S marca a peça que carrega
     o VALOR do conjunto; as peças N valem 0.
   - QRY0390: o estoque das peças, por endereço e restrição. O item pai nunca
     aparece nela. Nome, fornecedor, tipo, peso e modelo saem do NOME das peças.
   - Custo (opcional): preço de custo por item. Só o da peça S importa — ele é
     o valor do conjunto inteiro.

   As contas (por item pai), olhando TODO o estoque físico do CD:
     casados       = menor (saldo da peça / qtde por conjunto)   -> conjuntos inteiros
     casados venda = o mesmo, só com o saldo vendável (WN)
     fora da venda = casados - casados venda  -> conjunto inteiro no CD, mas com
                     peça em outra restrição (melhoria: juntar no vendável)
     descasados    = (maior nº de conjuntos que alguma peça permite) - casados
                     -> conjuntos começados, sem todas as peças no CD
     peças sem par = saldo que passa do necessário pros casados
     valor parado  = peças S sem par x custo  (dinheiro que não vira venda)
     valor em risco= conjuntos descasados SEM a peça S x valor do conjunto
                     (a peça S sumiu: venda incompleta, perda ou erro)
   Quem forma os casados: primeiro o saldo vendável, depois o 86 e as demais
   restrições; e dentro delas, as peças mais novas. Assim o que sobra (sem par)
   é o que está há mais tempo parado e nas restrições piores.
   ============================================================ */
(function(root){
  'use strict';

  const RESTR_VENDA = 'WN';
  const RESTR_NOME = {
    WN:'À venda', WA:'Reversa', DT:'Triagem', RT:'Conferência', AI:'Incompleto (86)',
    WT:'Análise', WD:'Obsoleto', WI:'Insumos', LT:'Litígio', WQ:'Quebra', WV:'Validade',
    WR:'Reparo', WL:'Não localizado', WS:'Leilão', WE:'Amostra', AT:'Múlt. reversa', SS:'Marca própria'
  };

  /* ---------- texto ---------- */
  function semAcento(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function limpar(s){ return semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function palavras(s){ return limpar(s).split(/[^A-Z0-9.,/+]+/).map(t => t.replace(/^[.,/]+|[.,/]+$/g, '')).filter(Boolean); }
  function chaveCab(s){ return semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function numero(v){
    if (typeof v === 'number') return v;
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function codigo(v){
    if (v == null || v === '') return '';
    if (typeof v === 'number') return String(Math.round(v));
    return String(v).trim().replace(/\.0+$/, '');
  }

  /* ---------- TIPO ----------
     A ordem importa: o primeiro que bater ganha. "RAMPA P/ ALINHAMENTO" é
     rampa, não alinhador — por isso Rampa vem antes. */
  const TIPOS = [
    ['Elevador', ['ELEVADOR', 'LEVADOR', 'ELEVACAR', 'ELEV', 'PANTOGRAFICO']],
    ['Macaco', ['MACACO', 'MACACOS']],
    ['Prensa', ['PRENSA']],
    ['Rampa', ['RAMPA', 'RAMPAS']],
    ['Guincho', ['GUINCHO', 'GIRAFA', 'GRUA']],
    ['Tartaruga', ['TARTARUGA']],
    ['Suporte de motor', ['SUPORTE+MOTOR', 'SUPORTE+MOTORES', 'SUSTENTACAO+MOTORES', 'CR+500+TOP']],
    ['Alinhador', ['ALINHADOR', 'ALINH', 'ALINHAMENTO']],
    ['Balanceadora', ['BALANCEADORA', 'BALANCEADOR', 'BALANC']],
    ['Desmontadora', ['DESMONTADORA', 'DESMONT']],
    ['Esquadrejadeira', ['ESQUADREJADEIRA', 'ESQUADREJ', 'ESQUADREJADEIR']],
    ['Desempenadeira', ['DESEMPENADEIRA']],
    ['Motosserra', ['MOTOSSERRA']],
    ['Serra', ['SERRA']],
    ['Roçadeira', ['ROCADEIRA', 'ROCAD']],
    ['Perfurador de solo', ['PERFURADOR', 'PERFU']],
    ['Furadeira', ['FURADEIRA']],
    ['Torno', ['TORNO']],
    ['Compressor', ['COMPRESSOR', 'COMP.AR', 'MOTOCOMPRESSOR']],
    ['Máquina de solda', ['SOLDA', 'MIG', 'INVERSORA', 'TIG', 'MULTIPROCESSO', 'MULTIPROCESSOS', 'MULTI+PROCESSO']],
    ['Máquina de corte', ['CORTAR', 'MAQUINA+CORTE', 'MAQ+CORTE', 'TESOURA']],
    ['Placa compactadora', ['COMPACTADORA']],
    ['Curvador de tubos', ['CURVADOR']],
    ['Lubrificação', ['PROPULSORA', 'LUBRIF', 'LUBRIFICACAO', 'GRAXA', 'ENGRAXADEIRA']],
    ['Motobomba', ['MOTOBOMBA']],
    ['Transpalete', ['TRANSPALETE', 'TRANSP', 'PALETEIRA', 'EMPILHADEIRA', 'EMPILHADEIR']],
    ['Betoneira', ['BETONEIRA']],
    ['Gerador', ['GERADOR']],
    ['Lavadora', ['LAVADORA', 'LAVA+RAPIDO']],
    ['Aparador', ['APARADOR']],
    ['Soprador', ['SOPRADOR']],
    ['Multifuncional', ['MULTIFUNCIONAL']],
    ['Coleta seletiva', ['LIXEIRA', 'LIXEIRAS', 'LIX', 'COLETA']],
    ['Distribuidor agrícola', ['DISTRIBUIDOR']],
    ['Porta-peças', ['PORTA+PECAS']],
    ['Pulverizador', ['PULVERIZADOR', 'ATOMIZADOR']],
    ['Motocultivador', ['MOTOCULTIVADOR', 'MOTOCULTIV', 'MOTOCUTIVADOR']],
    ['Cortador de grama', ['GRAMA', 'CORTADOR']],
    ['Bancada', ['BANCADA']],
    ['Armário', ['ARMARIO', 'ROUPEIRO']],
    ['Estante', ['ESTANTE', 'ESTANTES', 'PRATELEIRA', 'PRATELEIRAS']],
    ['Gaveteiro', ['GAVETEIRO', 'GAVETEIROS']],
    ['Carrinho', ['CARRINHO', 'CARRO', 'CARRINHOS', 'CARRIOLA', 'JERICA']],
    ['Cavalete', ['CAVALETE']],
    ['Escada', ['ESCADA']],
    ['Andaime', ['ANDAIME']],
    ['Talha', ['TALHA']],
    ['Mesa', ['MESA']],
    ['Rack', ['RACK']],
    ['Bomba', ['BOMBA']],
    ['Kit', ['KIT']]
  ];
  function tipoDosNomes(nomes){
    const tudo = new Set();
    nomes.forEach(n => palavras(n).forEach(t => { tudo.add(t); t.split(/[.,/+]/).forEach(x => tudo.add(x)); }));
    for (const [tipo, chaves] of TIPOS) if (chaves.some(k => k.split('+').every(x => tudo.has(x)))) return tipo;
    return 'Outros';
  }

  /* ---------- PESO (capacidade) ----------
     "2.5T", "2,5TON", "4 TONELADAS" e "2500 KGS" viram a mesma coisa. */
  function pesosDoNome(nome){
    const s = limpar(nome).replace(/(\d{1,2})\.(\d{3})(?!\d)/g, '$1$2'), out = [];   // 5.000 KGS -> 5000 KGS
    let m;
    const reT = /(?:^|[^A-Z0-9.,])(\d{1,3}(?:[.,]\d{1,2})?) ?(?:TONELADAS?|TON|T)(?![A-Z0-9])/g;
    while ((m = reT.exec(s))) out.push(parseFloat(m[1].replace(',', '.')) * 1000);
    const reK = /(?:^|[^A-Z0-9.,])(\d{2,5}(?:[.,]\d{1,2})?) ?KGS?(?![A-Z0-9])/g;
    while ((m = reK.exec(s))) out.push(parseFloat(m[1].replace(',', '.')));
    return out.filter(k => k > 0);
  }
  function rotuloPeso(kg){
    if (!kg) return 'Sem peso';
    if (kg >= 1000) return String(Math.round(kg / 10) / 100).replace('.', ',') + ' T';
    return String(kg).replace('.', ',') + ' kg';
  }

  /* ---------- FORNECEDOR ----------
     A marca vem quase sempre no fim do nome ("... ER2500 RIBEIRO"). A lista de
     marcas é aprendida da própria QRY0390: palavras que fecham o nome de
     vários itens. Palavras genéricas ("MAQUINAS", "PRO") puxam a anterior
     junto: "JM MAQUINAS" vira a marca JM. */
  const GENERICAS = new Set(['MAQUINAS', 'EQUIPAMENTOS', 'FERRAMENTAS', 'TOOLS', 'PRO', 'PLASTICOS', 'MOTORS', 'MACHINE',
    'BRASIL', 'TECH', 'AUTOMOTIVE', 'RUBBER', 'PLUS', 'IND', 'INDUSTRIAL', 'PROFISSIONAL', 'MOTORES', 'BOMBAS', 'METALURGICA']);
  const NAO_MARCA = new Set(['AZUL', 'VERMELHO', 'VERMELHA', 'PRETO', 'PRETA', 'BRANCO', 'BRANCA', 'AMARELO', 'AMARELA',
    'VERDE', 'CINZA', 'LARANJA', 'PRATA', 'RED', 'BLACK', 'MONO', 'TRIF', 'TRI', 'BIVOLT', 'UN', 'PC', 'PCS', 'KIT',
    'TONY', 'DECKER', 'DUTY', 'SAFETY', 'LINE', 'CABOS', 'ESCADAS', 'CINTO', 'CINTOS', 'LUB', 'SHARA', 'MECANICO',
    'ELEVADOR', 'MOTOR', 'BASE', 'COLUNA', 'COLUNAS', 'ACESSORIOS', 'COMPLETO', 'COMPLETA', 'ESQUERDO', 'DIREITO',
    'ESQUERDA', 'DIREITA', 'GRANDE', 'PEQUENO', 'MEDIO', 'SIMPLES', 'DUPLO', 'DUPLA', 'MANUAL', 'DIGITAL', 'S', 'N',
    'A', 'B', 'C', 'D', 'E', 'G', 'P', 'M', 'I', 'II', 'DE', 'COM', 'SEM', 'PARA', 'MM', 'CM', 'POL', 'KG', 'KGS', 'T',
    'BARRA', 'FIXA', 'METROS', 'LUGARES', 'PRATELEIRA', 'PRATELEIRAS', 'CAR', 'DO', 'DA', 'TON', 'V', 'W', 'HP', 'CV', 'L', 'LT', 'MT', 'MTS', 'NR', 'INOX', 'ACO', 'FERRO', 'MADEIRA', 'OLEO', 'AR']);
  const APELIDO = {FORTGPRO: 'FORTG', ORKK: 'ORK', LYHNUS: 'LYNUS'};
  function fimDoNome(nome){
    const t = palavras(nome).map(x => x.replace(/\.+$/, '')).filter(Boolean);
    if (!t.length) return null;
    let ult = t[t.length - 1];
    if (GENERICAS.has(ult) && t.length > 1){
      const ant = t[t.length - 2];
      if (!/\d/.test(ant) && !NAO_MARCA.has(ant) && !GENERICAS.has(ant)) return {chave: ant, rotulo: ant + ' ' + ult};
      return null;
    }
    if (/[\d/]/.test(ult) || ult.length < 2 || NAO_MARCA.has(ult)) return null;
    ult = APELIDO[ult] || ult;
    return {chave: ult, rotulo: ult};
  }
  function aprenderMarcas(nomesTodos, nomesMultiplos){
    const cont = new Map(), rot = new Map();
    const somar = (nome, peso) => {
      const f = fimDoNome(nome); if (!f) return;
      cont.set(f.chave, (cont.get(f.chave) || 0) + peso);
      let r = rot.get(f.chave); if (!r) rot.set(f.chave, r = new Map());
      r.set(f.rotulo, (r.get(f.rotulo) || 0) + 1);
    };
    nomesTodos.forEach(n => somar(n, 1));
    nomesMultiplos.forEach(n => somar(n, 2));   // marca rara, mas que se repete nos múltiplos
    const marcas = new Map();
    cont.forEach((n, chave) => {
      if (n < 5) return;
      const r = [...rot.get(chave).entries()].sort((a, b) => b[1] - a[1])[0][0];
      marcas.set(chave, {rotulo: r, freq: n});
    });
    return marcas;
  }
  function fornecedorDosNomes(nomes, marcas){
    const votos = new Map();
    nomes.forEach(nome => {
      const t = palavras(nome).map(x => x.replace(/\.+$/, ''));
      const sub = [];
      t.forEach((x, i) => { sub.push([x, i]); x.split(/[.,/+]/).forEach(y => { if (y !== x) sub.push([y, i]); }); });
      const vistos = new Set();
      sub.forEach(([x, i]) => {
        x = APELIDO[x] || x;
        if (!marcas.has(x) || vistos.has(x)) return;
        vistos.add(x);
        const noFim = i >= t.length - 2;
        votos.set(x, (votos.get(x) || 0) + (noFim ? 3 : 1));
      });
    });
    let melhor = null;
    votos.forEach((v, chave) => {
      const f = marcas.get(chave).freq;
      if (!melhor || v > melhor.v || (v === melhor.v && f > melhor.f)) melhor = {chave, v, f};
    });
    return melhor ? marcas.get(melhor.chave).rotulo : 'Sem fornecedor';
  }

  /* ---------- MODELO ----------
     O código do modelo é a última "palavra com número" do nome, depois de
     tirar a marca do fim e o que é tensão, peso, cor ou medida. */
  const NAO_MODELO = /^(\d+([.,]\d+)?(V|T|TON|TONELADAS?|KG|KGS|HZ|CV|HP|W|KW|VL|AH|MM|CM|M|L|LT|LTS|POL|PC|PCS|PCA|P|A|G|GAV|PES|MCA|BAR|PSI|RPM|CC|X\d.*)|\d+\/\d+V?|\d{1,2}|[123]F|\d+X\d+.*)$/;
  function modeloDoNome(nome, marcas){
    let t = palavras(nome).map(x => x.replace(/\.+$/, '')).filter(Boolean);
    while (t.length && (GENERICAS.has(t[t.length - 1]) || marcas.has(t[t.length - 1]) || NAO_MARCA.has(t[t.length - 1]))) t.pop();
    // 1ª passada: código com letra e número (ER2500); 2ª: só número (6135)
    for (const re of [/^(?=.*\d)(?=.*[A-Z])/, /\d/]){
      for (let i = t.length - 1; i >= Math.max(0, t.length - 4); i--){
        const x = t[i];
        if (re.test(x) && !NAO_MODELO.test(x) && !marcas.has(x)) return x;
      }
    }
    return null;
  }
  function maisVotado(lista){
    const c = new Map(); let melhor = null;
    lista.forEach(x => { if (x == null) return; const n = (c.get(x) || 0) + 1; c.set(x, n); if (!melhor || n > c.get(melhor)) melhor = x; });
    return melhor;
  }

  /* ---------- NOME DO CONJUNTO ----------
     Usa o nome do componente principal (S), sem o prefixo da peça
     ("BASE_", "COLUNA-"). */
  function nomeConjunto(comps){
    const c = comps.find(x => x.principal && x.nome) || comps.find(x => x.nome);
    if (!c) return '';
    return limpar(c.nome).replace(/^[A-Z ./]{2,28}[_]/, '').replace(/^(BASE|COLUNAS?|MOTOR|MAQUINA|MAQ)[- ]+(?=[A-Z])/, '').trim();
  }

  /* ---------- PAPEL DA PEÇA ("BASE", "COLUNA", "MOTOR"...) ---------- */
  const PAPEL_SIN = {CX: 'CAIXA', CAIXAS: 'CAIXA', ACESS: 'ACESSÓRIOS', ACES: 'ACESSÓRIOS', ACESSORIO: 'ACESSÓRIOS', ACESSORIOS: 'ACESSÓRIOS',
    COLUNAS: 'COLUNA', MAQ: 'MÁQUINA', MAQUINA: 'MÁQUINA', BRACOS: 'BRAÇO', BRACO: 'BRAÇO', GAVETAS: 'GAVETA', RODAS: 'RODA', CACAMBA: 'CAÇAMBA'};
  function papelDaPeca(nome){
    const s = limpar(nome);
    if (!s) return 'SEM SALDO NO CD';   // peça que não aparece na QRY0390: não dá pra saber o nome
    const m = s.match(/^([^_\-]{2,32})[_\-]/);
    const w = (m ? m[1] : s).trim().split(' ')[0].replace(/[^A-Z]/g, '');
    return PAPEL_SIN[w] || w || 'PEÇA';
  }

  /* ---------- LEITURA DAS PLANILHAS (matriz de linhas) ---------- */
  function acharColunas(cab, mapa, rotulo){
    const norm = cab.map(chaveCab), out = {};
    for (const campo in mapa){
      const [apelidos, obrigatoria] = mapa[campo];
      let idx = -1;
      for (const a of apelidos){ idx = norm.indexOf(chaveCab(a)); if (idx !== -1) break; }
      if (idx === -1 && obrigatoria) throw new Error(rotulo + ': não achei a coluna "' + apelidos[0] + '". Confira se é o relatório certo.');
      out[campo] = idx;
    }
    return out;
  }
  /* "dd/mm/aaaa hh:mm:ss" (ou data do Excel) -> dia corrido (número) */
  function diaDe(v){
    if (v == null || v === '') return null;
    if (v instanceof Date) return Math.floor(v.getTime() / 864e5);
    if (typeof v === 'number') return Math.floor(v) - 25569;   // número de série do Excel
    const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5) : null;
  }
  function textoDia(d){
    if (d == null) return '';
    const x = new Date(d * 864e5), p = n => String(n).padStart(2, '0');
    return p(x.getUTCDate()) + '/' + p(x.getUTCMonth() + 1) + '/' + x.getUTCFullYear();
  }

  function lerEstrutura(linhas){
    if (!linhas || linhas.length < 2) throw new Error('ZBIQ0051: planilha vazia.');
    const c = acharColunas(linhas[0], {
      pai: [['item_vol_multiplo', 'Item Vol.Multiplo'], true],
      comp: [['item_componente', 'Item Componente'], true],
      qtde: [['qtde', 'Quantidade'], false],
      flag: [['in_interface', 'in interface'], false]
    }, 'ZBIQ0051');
    const pais = new Map();
    for (let i = 1; i < linhas.length; i++){
      const l = linhas[i]; if (!l) continue;
      const pai = codigo(l[c.pai]), comp = codigo(l[c.comp]);
      if (!pai || !comp) continue;
      let lista = pais.get(pai); if (!lista) pais.set(pai, lista = []);
      if (lista.some(x => x.item === comp)) continue;
      lista.push({item: comp, qtde: (c.qtde !== -1 && numero(l[c.qtde])) || 1,
        principal: c.flag !== -1 && String(l[c.flag] || '').trim().toUpperCase() === 'S'});
    }
    if (!pais.size) throw new Error('ZBIQ0051: nenhuma linha válida.');
    return pais;
  }

  /* QRY0390. Guarda o nome de TODOS os itens (pra aprender as marcas) e o
     endereço a endereço só das peças de múltiplo. A planilha repete
     "Descrição" 3 vezes: nome do item, nome da Classe Local e endereço — as
     duas últimas vêm logo depois de "Classe Local" e de "Local". */
  function lerEstoque(linhas, pecas){
    if (!linhas || linhas.length < 2) throw new Error('QRY0390: planilha vazia.');
    const cab = linhas[0];
    const c = acharColunas(cab, {
      item: [['Item', 'ID_ITEM_FILHO'], true],
      nome: [['Descrição', 'NOME_ITEM_FILHO'], true],
      restr: [['Restrição', 'RETRICAO', 'RESTRICAO'], true],
      qtde: [['Quantidade', 'QTDE'], true],
      classe: [['Classe Local', 'CLAL'], false],
      local: [['Local', 'ID_LOCAL'], false],
      data: [['Data Situação', 'ULTIMA_ATUALIZACAO'], false],
      inv: [['Inventário'], false],
      valor: [['VALOR_UNITARIO', 'Valor Unitário'], false]
    }, 'QRY0390');
    const depois = i => (i !== -1 && chaveCab(cab[i + 1]).startsWith('descricao')) ? i + 1 : -1;
    const cDescClasse = depois(c.classe), cEndereco = depois(c.local);
    const itens = new Map(), custos390 = new Map(), nomes = [];
    let ultimo = null;
    const vistos = new Set();
    for (let i = 1; i < linhas.length; i++){
      const l = linhas[i]; if (!l) continue;
      const item = codigo(l[c.item]); if (!item) continue;
      if (!vistos.has(item)){ vistos.add(item); if (l[c.nome]) nomes.push(String(l[c.nome])); }
      const d = c.data !== -1 ? diaDe(l[c.data]) : null;
      if (d != null && (ultimo == null || d > ultimo)) ultimo = d;
      if (!pecas.has(item)) continue;
      let it = itens.get(item);
      if (!it) itens.set(item, it = {nome: String(l[c.nome] || '').trim(), locais: []});
      const q = numero(l[c.qtde]); if (!q) continue;
      it.locais.push({
        r: String(l[c.restr] || '').trim().toUpperCase() || '?',
        cl: c.classe !== -1 ? String(l[c.classe] || '').trim() : '',
        clNome: cDescClasse !== -1 ? String(l[cDescClasse] || '').trim() : '',
        local: c.local !== -1 ? codigo(l[c.local]) : '',
        end: cEndereco !== -1 ? String(l[cEndereco] || '').trim() : '',
        inv: c.inv !== -1 && /^em /i.test(String(l[c.inv] || '').trim()),
        q, d
      });
      if (c.valor !== -1 && numero(l[c.valor]) > 0) custos390.set(item, numero(l[c.valor]));
    }
    return {itens, nomes, custos390, diaBase: ultimo, dataBase: textoDia(ultimo)};
  }

  /* Base de custo (QRY0278 ou qualquer planilha com Item + uma coluna de preço) */
  function lerCustos(linhas){
    if (!linhas || linhas.length < 2) throw new Error('Custo: planilha vazia.');
    const c = acharColunas(linhas[0], {
      item: [['Item', 'ID_ITEM', 'Código', 'Codigo', 'Cod Item', 'SKU'], true],
      preco: [['Preço de custo', 'Custo médio', 'Custo', 'Preço custo', 'VALOR_UNITARIO', 'Valor unitário', 'Preço de compra', 'Preço'], true]
    }, 'Base de custo');
    const m = new Map();
    for (let i = 1; i < linhas.length; i++){
      const l = linhas[i]; if (!l) continue;
      const item = codigo(l[c.item]), p = numero(l[c.preco]);
      if (item && p > 0) m.set(item, p);
    }
    if (!m.size) throw new Error('Base de custo: nenhum preço encontrado.');
    return m;
  }

  /* ---------- MONTAGEM ---------- */
  const ORDEM_USO = ['WN', 'AI', 'RT', 'DT', 'WA', 'AT', 'WT', 'WD', 'LT', 'WE', 'WR', 'WI', 'WV', 'WL', 'SS', 'WQ', 'WS'];
  const prio = r => { const i = ORDEM_USO.indexOf(r); return i === -1 ? 50 : i; };

  function montar(pais, estoque, custos){
    custos = custos || new Map();
    const {itens} = estoque;
    const nomesMult = [];
    pais.forEach(comps => comps.forEach(c => { const it = itens.get(c.item); if (it && it.nome) nomesMult.push(it.nome); }));
    const marcas = aprenderMarcas(estoque.nomes, nomesMult);
    const custoDe = item => custos.get(item) || estoque.custos390.get(item) || 0;
    const hoje = estoque.diaBase;

    const conjuntos = []; let semEstoque = 0, semCusto = 0;
    pais.forEach((estrutura, pai) => {
      const comps = estrutura.map(c => {
        const it = itens.get(c.item), locais = it ? it.locais.slice() : [];
        const saldo = {}; let total = 0;
        locais.forEach(l => { saldo[l.r] = (saldo[l.r] || 0) + l.q; total += l.q; });
        return {item: c.item, nome: it ? it.nome : '', papel: papelDaPeca(it ? it.nome : ''), qtde: c.qtde, principal: c.principal,
          custo: c.principal ? custoDe(c.item) : 0, saldo, total, venda: saldo.WN || 0, locais};
      });
      const nomes = comps.map(c => c.nome).filter(Boolean);
      if (!nomes.length || comps.every(c => !c.total)){ semEstoque++; return; }

      const porPeca = comps.map(c => Math.floor(c.total / c.qtde));
      const casados = Math.min(...porPeca), maximo = Math.max(...porPeca);
      const casadosVenda = Math.min(...comps.map(c => Math.floor(c.venda / c.qtde)));
      const S = comps.find(c => c.principal) || null;
      const valorConj = S && S.custo ? S.custo * S.qtde : 0;
      if (S && !S.custo) semCusto++;

      const semPar = [], mover = [];
      comps.forEach(c => {
        // casados usam primeiro o vendável, depois as outras; dentro, o mais novo
        c.locais.sort((a, b) => prio(a.r) - prio(b.r) || (b.d || 0) - (a.d || 0));
        let usar = casados * c.qtde;
        c.sobra = c.total - usar;
        c.falta = maximo * c.qtde - c.total;
        c.locais.forEach(l => {
          const usado = Math.min(usar, l.q); usar -= usado;
          if (usado && l.r !== 'WN') mover.push({item: c.item, papel: c.papel, principal: c.principal, r: l.r, cl: l.cl, clNome: l.clNome, end: l.end, local: l.local, q: usado, inv: l.inv});
          const resto = l.q - usado;
          if (resto > 0) semPar.push({item: c.item, papel: c.papel, principal: c.principal, r: l.r, cl: l.cl, clNome: l.clNome, end: l.end, local: l.local, q: resto,
            valor: c.principal ? resto * c.custo : 0, idade: (hoje != null && l.d != null) ? Math.max(0, hoje - l.d) : null, inv: l.inv});
        });
      });
      const descasados = maximo - casados;
      const sobraS = S ? S.sobra : 0;
      const descSemS = S ? Math.max(0, descasados - Math.floor(sobraS / S.qtde)) : 0;
      const pecasSemPar = semPar.reduce((s, x) => s + x.q, 0);
      const idade = semPar.reduce((m, x) => x.idade != null && x.idade > m ? x.idade : m, -1);

      const tipo = tipoDosNomes(nomes);
      let kg = maisVotado([].concat(...nomes.map(pesosDoNome)));
      if (!kg && tipo === 'Elevador'){
        kg = maisVotado([].concat(...nomes.map(n => (limpar(n).match(/(?:^| )([1-9]\d00)(?= |$)/g) || []).map(x => +x))));
      }
      conjuntos.push({
        pai, nome: nomeConjunto(comps),
        fornecedor: fornecedorDosNomes(nomes, marcas), tipo,
        pesoKg: kg || 0, peso: rotuloPeso(kg),
        modelo: maisVotado(nomes.map(n => modeloDoNome(n, marcas))) || 'Sem modelo',
        status: descasados > 0 ? 'Descasado' : 'Casado',
        casados, casadosVenda, foraVenda: casados - casadosVenda, descasados, descSemS,
        pecasTotal: comps.reduce((s, c) => s + c.total, 0), pecasSemPar,
        valorConj, temCusto: !!valorConj,
        valorCasado: casados * valorConj, valorForaVenda: (casados - casadosVenda) * valorConj,
        valorParado: S ? sobraS * S.custo : 0, valorRisco: descSemS * valorConj,
        idadeSemPar: idade < 0 ? null : idade,
        comps: comps.map(c => ({item: c.item, nome: c.nome, papel: c.papel, qtde: c.qtde, principal: c.principal, custo: c.custo,
          saldo: c.saldo, total: c.total, venda: c.venda, sobra: c.sobra, falta: c.falta})),
        semPar, mover
      });
    });
    return {conjuntos, semEstoque, semCusto, totalPais: pais.size, dataBase: estoque.dataBase,
      temCusto: custos.size > 0 || estoque.custos390.size > 0};
  }

  const api = {montar, lerEstrutura, lerEstoque, lerCustos, rotuloPeso, pesosDoNome, tipoDosNomes, papelDaPeca, RESTR_NOME, RESTR_VENDA, TIPOS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EM_REGRAS = api;
})(typeof self !== 'undefined' ? self : globalThis);
