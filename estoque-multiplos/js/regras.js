/* ============================================================
   Estoque de Múltiplos — regras (usado pelo worker e pelos testes)
   ============================================================
   De onde vem cada coisa:
   - ZBIQ0051: a estrutura. Cada linha liga um item pai (item_vol_multiplo) a
     um componente (item_componente). in_interface = S marca o componente
     PRINCIPAL (o que carrega o valor do conjunto); N vale 0.
   - QRY0390: o estoque, por componente, local e restrição. O item pai nunca
     aparece nela — só os componentes. Por isso o nome do conjunto, o
     fornecedor, o tipo, o peso e o modelo são lidos do NOME dos componentes.

   Conta de estoque:
   Um conjunto só existe inteiro quando tem todas as peças. Com 3 bases e 2
   colunas à venda, são 2 conjuntos completos e 1 base sobrando.
     completos à venda = menor (saldo WN do componente / qtde por conjunto)
     sobra             = saldo WN que passa do necessário pros completos
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
  function lerEstoque(linhas){
    if (!linhas || linhas.length < 2) throw new Error('QRY0390: planilha vazia.');
    const c = acharColunas(linhas[0], {
      item: [['Item', 'ID_ITEM_FILHO'], true],
      nome: [['Descrição', 'NOME_ITEM_FILHO'], true],   // a 1ª "Descrição" é o nome do item
      restr: [['Restrição', 'RETRICAO', 'RESTRICAO'], true],
      qtde: [['Quantidade', 'QTDE'], true],
      data: [['Data Situação', 'ULTIMA_ATUALIZACAO'], false]
    }, 'QRY0390');
    const itens = new Map(); let ultima = '';
    for (let i = 1; i < linhas.length; i++){
      const l = linhas[i]; if (!l) continue;
      const item = codigo(l[c.item]); if (!item) continue;
      let it = itens.get(item); if (!it) itens.set(item, it = {nome: String(l[c.nome] || '').trim(), saldo: {}});
      const r = String(l[c.restr] || '').trim().toUpperCase() || '?';
      it.saldo[r] = (it.saldo[r] || 0) + numero(l[c.qtde]);
      if (c.data !== -1 && l[c.data]){
        const d = String(l[c.data]), m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))?/);
        const ord = m ? m[3] + m[2] + m[1] + (m[4] || '') : '';
        if (ord > ultima) ultima = ord;
      }
    }
    const dataBase = ultima ? ultima.slice(6, 8) + '/' + ultima.slice(4, 6) + '/' + ultima.slice(0, 4) + ' ' + ultima.slice(8) : '';
    return {itens, dataBase: dataBase.trim()};
  }

  /* ---------- MONTAGEM ---------- */
  function montar(pais, estoque){
    const {itens} = estoque;
    const nomesTodos = [], nomesMult = [];
    itens.forEach(it => { if (it.nome) nomesTodos.push(it.nome); });
    pais.forEach(comps => comps.forEach(c => { const it = itens.get(c.item); if (it && it.nome) nomesMult.push(it.nome); }));
    const marcas = aprenderMarcas(nomesTodos, nomesMult);

    const conjuntos = []; let semEstoque = 0;
    pais.forEach((estrutura, pai) => {
      const comps = estrutura.map(c => {
        const it = itens.get(c.item), saldo = it ? it.saldo : {};
        let total = 0; for (const r in saldo) total += saldo[r];
        return {item: c.item, nome: it ? it.nome : '', qtde: c.qtde, principal: c.principal,
          saldo, venda: saldo[RESTR_VENDA] || 0, total};
      });
      const nomes = comps.map(c => c.nome).filter(Boolean);
      if (!nomes.length){ semEstoque++; return; }   // nenhum componente na 390: sem saldo e sem nome

      const completos = Math.min(...comps.map(c => Math.floor(c.venda / c.qtde)));
      const fisicos = Math.min(...comps.map(c => Math.floor(c.total / c.qtde)));
      let sobra = 0, foraVenda = 0;
      comps.forEach(c => { c.sobra = c.venda - completos * c.qtde; sobra += c.sobra; foraVenda += c.total - c.venda; });
      const temVenda = comps.some(c => c.venda > 0);
      const status = sobra > 0 ? 'Descasado' : completos > 0 ? 'Completo' : foraVenda > 0 ? 'Fora de venda' : 'Sem estoque';

      const tipo = tipoDosNomes(nomes);
      let kg = maisVotado([].concat(...nomes.map(pesosDoNome)));
      // Elevador sem unidade no nome ("ATP 4000"): o número redondo é a capacidade em kg
      if (!kg && tipo === 'Elevador'){
        kg = maisVotado([].concat(...nomes.map(n => (limpar(n).match(/(?:^| )([1-9]\d00)(?= |$)/g) || []).map(x => +x))));
      }
      conjuntos.push({
        pai, nome: nomeConjunto(comps),
        fornecedor: fornecedorDosNomes(nomes, marcas),
        tipo,
        pesoKg: kg || 0, peso: rotuloPeso(kg),
        modelo: maisVotado(nomes.map(n => modeloDoNome(n, marcas))) || 'Sem modelo',
        completos, fisicos, sobra, foraVenda, temVenda, status, comps
      });
    });
    return {conjuntos, semEstoque, totalPais: pais.size, dataBase: estoque.dataBase};
  }

  const api = {montar, lerEstrutura, lerEstoque, rotuloPeso, pesosDoNome, tipoDosNomes, RESTR_NOME, RESTR_VENDA, TIPOS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EM_REGRAS = api;
})(typeof self !== 'undefined' ? self : globalThis);
