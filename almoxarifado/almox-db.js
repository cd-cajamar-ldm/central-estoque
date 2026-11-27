/* ============================================================
   ALMOXARIFADO DA OFICINA — o "banco de relatórios" compartilhado
   ------------------------------------------------------------
   Guarda os relatórios EXATAMENTE como chegam (o arquivo cru: CSV ou Excel),
   cada um na sua "prateleira" (QRY0390, QRY0160, ...). Quem trata os dados é
   cada app, do seu jeito: o Almoxarifado só guarda e diz de quando é cada um.

   Todos os apps da Oficina moram no mesmo site, então todos enxergam este
   mesmo banco do navegador. Para um app usar uma base:

     <script src="../almoxarifado/almox-db.js"></script>
     const pacote = await LDM_ALMOX.pacote('QRY0390');
     // pacote.arquivos = [{nome, parte, modificado, blob}, ...] — já na ordem das partes
     for(const a of pacote.arquivos){ const buf = await a.blob.arrayBuffer(); ... }

   E para saber quando o Almoxarifado recebeu algo novo:
     LDM_ALMOX.aoAtualizar(function(ids){ ... });

   Sem senha, token ou chave aqui: a pasta é lida com a permissão do próprio
   navegador, que a pessoa concede com um clique.
   ============================================================ */
(function(){
  'use strict';

  var DB_NOME = 'oficina_almoxarifado_v1';
  var DB_VERSAO = 1;
  var CANAL = 'ldm-almoxarifado';

  /* O CADASTRO das queries que já conhecemos. Ele NÃO limita o que aparece:
     qualquer query que cair na pasta vira uma linha sozinha (ver classificar).
     O cadastro só dá nome amigável, origem, ritmo e quem usa.

     `fonte`: de onde o dado vem hoje — 'snowflake' | 'fluxo' (fluxo de dados do
              Power BI) | 'manual' (baixado/feito à mão). Ao migrar uma query para
              o Snowflake, é só trocar aqui.
     `ritmo`: de quanto em quanto tempo deveria chegar
       auto   → a cada 2 h (atrasada depois de 4 h)
       diario → a origem só atualiza de madrugada (atrasada depois de 30 h)
       manual → alguém baixa e salva (antiga depois de 7 dias)
     `apps`:  chaves do catálogo da Oficina (index.html).
     `codigo`: o código no nome do arquivo; `apelido`: nomes editados à mão sem
              código (os mesmos que o Inventário Rotativo já reconhece). */
  var CADASTRO = [
    { id:'QRY0390', nome:'Estoque por endereço', fonte:'snowflake', ritmo:'auto',
      codigo:/QRY0*390(?!\d)/i,
      apps:['checkvolume','inventario','transitorios','multiplos','elevadores','estoque'] },
    { id:'QRY0160', nome:'Tempo parado no endereço', fonte:'fluxo', ritmo:'diario',
      codigo:/QRY0*160(?!\d)/i,
      apps:['inventario','transitorios','multiplos'] },
    { id:'SIGEQ278', nome:'Custo dos itens', fonte:'fluxo', ritmo:'auto',
      codigo:/SIGEQ0*278(?!\d)/i,
      apps:['inventario','transitorios','multiplos','elevadores'] },
    { id:'ZBIQ0051', nome:'Item pai × componente (kits)', fonte:'fluxo', ritmo:'auto',
      codigo:/ZBIQ0*51(?!\d)/i,
      apps:['inventario','transitorios','multiplos'] },
    { id:'QRY410', nome:'Movimentações (NET)', fonte:'snowflake', ritmo:'manual',
      codigo:/(QRY|SIGEQ)0*410(?!\d)/i, apelido:/livro\s*fiscal|\bnet\b/i,
      apps:['inventario','transitorios'] },
    { id:'QRY0843', nome:'Contagens do inventário', fonte:'manual', ritmo:'manual',
      codigo:/QRY0*843(?!\d)/i,
      apps:['inventario'] },
    { id:'QRY0180', nome:'Pedidos', fonte:'snowflake', ritmo:'auto',
      codigo:/QRY0*180(?!\d)/i,
      apps:['checkvolume'] },
    { id:'SIGEQ230', nome:'Cadastro de itens', fonte:'fluxo', ritmo:'diario',
      codigo:/SIGEQ0*230(?!\d)/i,
      apps:['checkvolume'] },
    { id:'FOTOS', rotulo:'Fotos', nome:'Fotos dos itens (link)', fonte:'manual', ritmo:'manual',
      codigo:/(^|[^a-z])fotos?([^a-z]|$)/i,
      apps:['checkvolume'] },
    { id:'QRY0114', nome:'Divergências de endereço', fonte:'fluxo', ritmo:'auto',
      codigo:/QRY0*114(?!\d)/i,
      apps:['estoque','transitorios'] },
    { id:'CONGELADA', rotulo:'Base Congelada', nome:'Locais congelados do ciclo', fonte:'manual', ritmo:'manual',
      codigo:/base\s*congelada/i, apelido:/congelad|espelho/i,
      apps:['inventario'] }
  ];
  var POR_ID = {};
  CADASTRO.forEach(function(p){ POR_ID[p.id] = p; });

  var LIMITE_HORAS = { auto: 4, diario: 30, manual: 24 * 7 };
  var EXTENSOES = /\.(csv|txt|xlsx|xlsm|xls)$/i;
  var LIXO = /^~\$|^\.|^desktop\.ini$|^thumbs\.db$/i;

  /* Qual query um arquivo é, pelo nome:
     1. o código de uma query do cadastro (QRY0390, SIGEQ410...);
     2. um apelido do cadastro ("Net - Livro Fiscal" → QRY410);
     3. qualquer código no formato LETRAS+NÚMERO → query nova, ex. "QRY180 - Recebimentos.csv" → QRY0180;
     4. senão, o próprio nome do arquivo (sem extensão e sem "_parteN").
     Só não vira query o que não é planilha (ver EXTENSOES) ou é arquivo de sistema. */
  function classificar(nome){
    var base = String(nome || '');
    if(LIXO.test(base) || !EXTENSOES.test(base)) return null;
    var i;
    for(i = 0; i < CADASTRO.length; i++) if(CADASTRO[i].codigo.test(base)) return CADASTRO[i].id;
    for(i = 0; i < CADASTRO.length; i++) if(CADASTRO[i].apelido && CADASTRO[i].apelido.test(base)) return CADASTRO[i].id;
    var m = /(?:^|[^A-Za-z])([A-Za-z]{2,8})[\s_-]*0*(\d{1,5})(?!\d)/.exec(base.replace(/parte\s*[_-]?\s*\d+/i, ''));
    if(m){
      var pref = m[1].toUpperCase(), num = m[2];
      if(pref === 'QRY') while(num.length < 4) num = '0' + num;
      return pref + num;
    }
    var limpo = base.replace(EXTENSOES, '').replace(/[\s_-]*parte\s*[_-]?\s*\d+/i, '').trim();
    return limpo.slice(0, 40) || null;
  }
  /* "QRY0390_parte2.csv" → 2. Sem "parte" no nome → 0 (arquivo inteiro). */
  function parteDe(nome){
    var m = /parte\s*[_-]?\s*(\d+)/i.exec(String(nome || ''));
    return m ? parseInt(m[1], 10) : 0;
  }
  /* A ficha de uma query: a do cadastro, ou uma ficha "nova" para a que só
     apareceu na pasta. */
  function fonteDoNome(nome){
    var n = String(nome || '').replace(EXTENSOES, '');
    if(/(^|[\s_-])snow(flake)?$/i.test(n)) return 'snowflake';
    if(/(^|[\s_-])fluxo$/i.test(n)) return 'fluxo';
    if(/(^|[\s_-])manual$/i.test(n)) return 'manual';
    return null;
  }
  function ficha(id){
    return POR_ID[id] || { id: id, nome: '', fonte: 'indefinida', ritmo: 'auto', apps: [], nova: true };
  }

  /* ---------------- banco (IndexedDB) ---------------- */
  var dbPromessa = null;
  function abrir(){
    if(dbPromessa) return dbPromessa;
    dbPromessa = new Promise(function(ok, falha){
      var req = indexedDB.open(DB_NOME, DB_VERSAO);
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains('arquivos')){
          var st = db.createObjectStore('arquivos', { keyPath: 'nome' });
          st.createIndex('prateleira', 'prateleira', { unique: false });
        }
        if(!db.objectStoreNames.contains('config')) db.createObjectStore('config');
      };
      req.onsuccess = function(){ ok(req.result); };
      req.onerror = function(){ dbPromessa = null; falha(req.error); };
    });
    return dbPromessa;
  }
  function tx(loja, modo, fn){
    return abrir().then(function(db){
      return new Promise(function(ok, falha){
        var t = db.transaction(loja, modo);
        var resultado = fn(t.objectStore(loja));
        t.oncomplete = function(){ ok(resultado && 'result' in resultado ? resultado.result : resultado); };
        t.onerror = function(){ falha(t.error); };
        t.onabort = function(){ falha(t.error); };
      });
    });
  }
  function configLer(chave){ return tx('config', 'readonly', function(s){ return s.get(chave); }); }
  function configGravar(chave, valor){ return tx('config', 'readwrite', function(s){ s.put(valor, chave); }); }
  function configApagar(chave){ return tx('config', 'readwrite', function(s){ s.delete(chave); }); }

  /* Todos os arquivos guardados (com o blob — o navegador só lê o conteúdo
     de verdade quando alguém pede, então listar é leve). */
  function listar(){
    return tx('arquivos', 'readonly', function(s){ return s.getAll(); }).then(function(l){ return l || []; });
  }

  /* Conta as linhas de um CSV sem montar a planilha (só para mostrar na tela).
     Excel fica sem contagem: abrir um .xlsx aqui pesaria mais que o próprio app. */
  function contarLinhas(buf, nome){
    if(!/\.(csv|txt)$/i.test(nome)) return null;
    var b = new Uint8Array(buf), n = 0;
    for(var i = 0; i < b.length; i++) if(b[i] === 10) n++;
    if(b.length && b[b.length - 1] !== 10) n++;
    return Math.max(0, n - 1); // menos o cabeçalho
  }

  /* Guarda uma lista de File (vindos da pasta ou escolhidos à mão).
     Arquivo com o mesmo nome é substituído. Um de cada vez, para não segurar
     vários arquivos grandes na memória ao mesmo tempo. O conteúdo é copiado
     (new Blob) para o banco não depender do arquivo continuar igual no disco. */
  function guardarArquivos(arquivos, origem){
    var aceitos = [], ignorados = [];
    Array.prototype.forEach.call(arquivos, function(f){
      var prat = classificar(f.name);
      if(prat) aceitos.push({ f: f, prat: prat }); else ignorados.push(f.name);
    });
    var guardados = [], ids = [];
    var fila = Promise.resolve();
    aceitos.forEach(function(a){
      fila = fila.then(function(){ return a.f.arrayBuffer(); }).then(function(buf){
        var reg = {
          nome: a.f.name, prateleira: a.prat, parte: parteDe(a.f.name),
          tamanho: a.f.size, modificado: a.f.lastModified || Date.now(),
          importadoEm: Date.now(), origem: origem || 'manual',
          linhas: contarLinhas(buf, a.f.name),
          blob: new Blob([buf], { type: a.f.type || '' })
        };
        return tx('arquivos', 'readwrite', function(s){ s.put(reg); }).then(function(){
          guardados.push(reg.nome);
          if(ids.indexOf(reg.prateleira) < 0) ids.push(reg.prateleira);
        });
      });
    });
    return fila.then(function(){
      if(guardados.length) avisar(ids);
      return { guardados: guardados, ignorados: ignorados, prateleiras: ids };
    });
  }

  function remover(nome){
    return tx('arquivos', 'readwrite', function(s){ s.delete(nome); }).then(function(){ avisar([]); });
  }

  /* ---------------- pasta conectada ---------------- */
  var suportaPasta = typeof window.showDirectoryPicker === 'function';

  function pastaSalva(){ return configLer('pasta').then(function(h){ return h || null; }).catch(function(){ return null; }); }

  /* 'granted' | 'prompt' | 'denied'. Com pedir=true abre a pergunta do navegador
     (só funciona dentro de um clique). */
  function permissao(handle, pedir){
    if(!handle || !handle.queryPermission) return Promise.resolve('denied');
    var opts = { mode: 'read' };
    return handle.queryPermission(opts).then(function(st){
      if(st === 'granted' || !pedir) return st;
      return handle.requestPermission(opts);
    }).catch(function(){ return 'denied'; });
  }

  function conectarPasta(){
    return window.showDirectoryPicker({ mode: 'read', id: 'oficina-bases' }).then(function(h){
      return configGravar('pasta', h).then(function(){ return h; });
    });
  }
  function desconectarPasta(){ return configApagar('pasta'); }

  /* Lê a pasta e deixa o Almoxarifado igual a ela:
     - arquivo novo ou alterado → guarda;
     - igual ao que já está → não mexe;
     - sumiu da pasta (e tinha vindo dela) → sai da prateleira.
     Arquivos postos à mão não são apagados por isso. */
  function lerPasta(handle, aoProgresso){
    var naPasta = [];
    var ignorados = [];
    var it = handle.values();
    function proximo(){
      return it.next().then(function(r){
        if(r.done) return;
        var h = r.value;
        if(h.kind === 'file'){
          if(classificar(h.name)) naPasta.push(h);
          else if(!LIXO.test(h.name)) ignorados.push(h.name);
        }
        return proximo();
      });
    }
    return proximo().then(function(){
      return listar();
    }).then(function(guardados){
      var porNome = {};
      guardados.forEach(function(g){ porNome[g.nome] = g; });
      var nomesPasta = {};
      var feitos = 0;
      return Promise.all(naPasta.map(function(h){
        nomesPasta[h.name] = true;
        return h.getFile().then(function(f){
          feitos++;
          if(aoProgresso) aoProgresso(feitos, naPasta.length, h.name);
          var g = porNome[f.name];
          return (g && g.tamanho === f.size && g.modificado === f.lastModified) ? null : f;
        });
      })).then(function(lista){
        var novos = lista.filter(Boolean);
        var sumiram = guardados.filter(function(g){ return g.origem === 'pasta' && !nomesPasta[g.nome]; });
        var apagar = sumiram.length
          ? tx('arquivos', 'readwrite', function(s){ sumiram.forEach(function(g){ s.delete(g.nome); }); })
          : Promise.resolve();
        return apagar.then(function(){ return novos.length ? guardarArquivos(novos, 'pasta') : { guardados: [] }; })
          .then(function(res){
            if(!novos.length && sumiram.length) avisar([]);
            var resumo = {
              novos: res.guardados.length,
              iguais: naPasta.length - novos.length,
              removidos: sumiram.map(function(g){ return g.nome; }),
              ignorados: ignorados.sort(),
              lidoEm: Date.now()
            };
            return configGravar('ultimaLeitura', resumo).then(function(){ return resumo; });
          });
      });
    });
  }
  function ultimaLeitura(){ return configLer('ultimaLeitura').catch(function(){ return null; }); }

  /* ---------------- o que cada app consome ---------------- */

  /* O conjunto atual de uma prateleira: a versão mais nova de cada parte.
     Se houver um arquivo inteiro (sem "parte") mais novo que todas as partes,
     ele vale sozinho; senão valem as partes. */
  function montarPacote(id, arquivos){
    var daPrat = arquivos.filter(function(a){ return a.prateleira === id; });
    var porParte = {};
    daPrat.forEach(function(a){
      var atual = porParte[a.parte];
      if(!atual || a.modificado > atual.modificado) porParte[a.parte] = a;
    });
    var inteiro = porParte[0] || null;
    var partes = Object.keys(porParte).map(Number).filter(function(n){ return n > 0; })
      .sort(function(a, b){ return a - b; }).map(function(n){ return porParte[n]; });
    var maisNovaParte = partes.reduce(function(m, a){ return Math.max(m, a.modificado); }, 0);
    var escolhidos = (inteiro && (!partes.length || inteiro.modificado >= maisNovaParte)) ? [inteiro] : partes;
    var usados = {};
    escolhidos.forEach(function(a){ usados[a.nome] = true; });
    var datas = escolhidos.map(function(a){ return a.modificado; });
    var linhas = escolhidos.every(function(a){ return a.linhas != null; })
      ? escolhidos.reduce(function(s, a){ return s + a.linhas; }, 0) : null;
    return {
      id: id,
      // O sufixo no nome do arquivo ("- Snow", "- Fluxo") manda na origem.
      prateleira: (function(){
        var f = ficha(id), fn = null;
        escolhidos.forEach(function(a){ fn = fn || fonteDoNome(a.nome); });
        if(!fn) return f;
        var c = {}; for(var k in f) c[k] = f[k];
        c.fonte = fn; return c;
      })(),
      arquivos: escolhidos,
      deFora: daPrat.filter(function(a){ return !usados[a.nome]; }), // versões antigas que sobraram
      dadosDe: datas.length ? Math.min.apply(null, datas) : null,   // a parte mais antiga manda
      tamanho: escolhidos.reduce(function(s, a){ return s + a.tamanho; }, 0),
      linhas: linhas
    };
  }
  function pacote(id){ return listar().then(function(l){ return montarPacote(id, l); }); }
  function pacotes(){
    return listar().then(function(l){
      // As do cadastro primeiro, depois as que só apareceram na pasta.
      var ids = CADASTRO.map(function(p){ return p.id; });
      l.forEach(function(a){ if(ids.indexOf(a.prateleira) < 0) ids.push(a.prateleira); });
      return ids.map(function(id){ return montarPacote(id, l); });
    });
  }

  /* 'vazia' | 'em-dia' | 'atrasada' (auto/diário) | 'antiga' (manual) */
  function situacao(pac, agora){
    if(!pac.arquivos.length) return 'vazia';
    var horas = ((agora || Date.now()) - pac.dadosDe) / 36e5;
    var ritmo = pac.prateleira.ritmo;
    if(horas <= LIMITE_HORAS[ritmo]) return 'em-dia';
    return ritmo === 'manual' ? 'antiga' : 'atrasada';
  }

  /* ---------------- aviso entre abas ---------------- */
  var canal = null;
  try { canal = new BroadcastChannel(CANAL); } catch(e){ canal = null; }
  var ouvintes = [];
  function avisar(ids){
    var msg = { tipo: 'atualizado', prateleiras: ids || [], em: Date.now() };
    if(canal) try { canal.postMessage(msg); } catch(e){}
    ouvintes.forEach(function(fn){ try { fn(msg.prateleiras); } catch(e){} });
  }
  if(canal) canal.onmessage = function(ev){
    var d = ev.data || {};
    if(d.tipo === 'atualizado') ouvintes.forEach(function(fn){ try { fn(d.prateleiras || []); } catch(e){} });
  };
  function aoAtualizar(fn){ ouvintes.push(fn); }

  /* ---------------- automação do PC (pasta Bases) ----------------
     _automacao/horarios.json  → quando cada Excel deve ser atualizado (editado aqui)
     _registro/estado.json     → o que o script do PC fez com cada um (só leitura) */
  function lerJsonDaPasta(handle, sub, nome){
    return handle.getDirectoryHandle(sub).then(function(d){ return d.getFileHandle(nome); })
      .then(function(f){ return f.getFile(); }).then(function(f){ return f.text(); })
      .then(function(t){ return JSON.parse(t.replace(/^\uFEFF/, '')); })
      .catch(function(){ return null; });
  }
  function lerAutomacao(handle){
    if(!handle) return Promise.resolve(null);
    return Promise.all([
      lerJsonDaPasta(handle, '_automacao', 'horarios.json'),
      lerJsonDaPasta(handle, '_registro', 'estado.json'),
      handle.getDirectoryHandle('_automacao').then(function(){ return true; }).catch(function(){ return false; })
    ]).then(function(r){
      var h = r[0] || {};
      return {
        instalada: r[2],
        padrao: Array.isArray(h.padrao) ? h.padrao : ['06:00'],
        relatorios: h.relatorios || {},
        estado: r[1] || {}
      };
    });
  }
  function gravarHorarios(handle, padrao, relatorios){
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function(st){
      return st === 'granted' ? st : handle.requestPermission(opts);
    }).then(function(st){
      if(st !== 'granted') throw new Error('o navegador não liberou gravar na pasta');
      return handle.getDirectoryHandle('_automacao', { create: true });
    }).then(function(d){ return d.getFileHandle('horarios.json', { create: true }); })
      .then(function(f){ return f.createWritable(); })
      .then(function(w){
        var txt = JSON.stringify({ padrao: padrao, relatorios: relatorios }, null, 2) + '\n';
        return w.write(txt).then(function(){ return w.close(); });
      });
  }

  window.LDM_ALMOX = {
    lerAutomacao: lerAutomacao,
    gravarHorarios: gravarHorarios,
    fonteDoNome: fonteDoNome,
    CADASTRO: CADASTRO,
    ficha: ficha,
    classificar: classificar,
    parteDe: parteDe,
    suportaPasta: suportaPasta,
    pastaSalva: pastaSalva,
    permissao: permissao,
    conectarPasta: conectarPasta,
    desconectarPasta: desconectarPasta,
    lerPasta: lerPasta,
    ultimaLeitura: ultimaLeitura,
    guardarArquivos: guardarArquivos,
    remover: remover,
    listar: listar,
    pacote: pacote,
    pacotes: pacotes,
    situacao: situacao,
    aoAtualizar: aoAtualizar
  };
})();
