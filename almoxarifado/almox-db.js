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

  /* As prateleiras. `apps` usa a mesma chave do catálogo da Oficina (index.html).
     `ritmo` diz de quanto em quanto tempo a base deveria chegar:
       auto   → Power Automate a cada 2 h (atrasada depois de 4 h)
       diario → a origem só atualiza de madrugada (atrasada depois de 30 h)
       manual → alguém baixa e salva (antiga depois de 7 dias)
     `codigo` reconhece o nome "oficial"; `apelido` pega o nome editado à mão
     (mesmos padrões do Inventário Rotativo, que aprendeu isso na prática). */
  var PRATELEIRAS = [
    { id:'QRY0390', nome:'Estoque por endereço', ritmo:'auto',
      origem:'Automática (Power BI → Power Automate)',
      codigo:/QRY0*390/i, apelido:/0?390/i,
      apps:['inventario','transitorios','multiplos','elevadores','estoque'] },
    { id:'QRY0160', nome:'Tempo parado no endereço', ritmo:'diario',
      origem:'Automática, mas a origem só atualiza de madrugada',
      codigo:/QRY0*160/i, apelido:/0?160/i,
      apps:['inventario','transitorios','multiplos'] },
    { id:'SIGEQ278', nome:'Custo dos itens', ritmo:'auto',
      origem:'Automática (Power BI → Power Automate)',
      codigo:/SIGEQ0*278/i, apelido:/278/i,
      apps:['inventario','transitorios','multiplos','elevadores'] },
    { id:'ZBIQ0051', nome:'Item pai × componente (kits)', ritmo:'auto',
      origem:'Automática (Power BI → Power Automate)',
      codigo:/ZBIQ0*51/i, apelido:/0?051|zbiq/i,
      apps:['inventario','transitorios','multiplos'] },
    { id:'QRY410', nome:'Movimentações (NET)', ritmo:'manual',
      origem:'Manual por enquanto: baixar e salvar na pasta',
      codigo:/(QRY|SIGEQ)0*410/i, apelido:/(^|[^0-9])410([^0-9]|$)|livro\s*fiscal|\bnet\b/i,
      apps:['inventario','transitorios'] },
    { id:'QRY0843', nome:'Contagens do inventário', ritmo:'manual',
      origem:'Manual: a do Power BI está incompleta',
      codigo:/QRY0*843/i, apelido:/0?843/i,
      apps:['inventario'] },
    { id:'QRY0114', nome:'Divergências de endereço', ritmo:'manual',
      origem:'Manual por enquanto',
      codigo:/QRY0*114/i, apelido:/0?114/i,
      apps:['estoque','transitorios'] },
    { id:'CONGELADA', rotulo:'Base Congelada', nome:'Locais congelados do ciclo', ritmo:'manual',
      dicaNome:'um arquivo com “congelada” no nome',
      origem:'Manual: planilha feita à mão a cada ciclo',
      codigo:/base\s*congelada/i, apelido:/congelad|espelho/i,
      apps:['inventario'] }
  ];
  var POR_ID = {};
  PRATELEIRAS.forEach(function(p){ POR_ID[p.id] = p; });

  var LIMITE_HORAS = { auto: 4, diario: 30, manual: 24 * 7 };
  var EXTENSOES = /\.(csv|txt|xlsx|xlsm|xls)$/i;

  /* Qual prateleira um arquivo ocupa, pelo nome. Primeiro o código oficial
     (mais seguro), depois o apelido. Nada reconhecido → null. */
  function classificar(nome){
    var base = String(nome || '');
    var i;
    for(i = 0; i < PRATELEIRAS.length; i++) if(PRATELEIRAS[i].codigo.test(base)) return PRATELEIRAS[i].id;
    for(i = 0; i < PRATELEIRAS.length; i++) if(PRATELEIRAS[i].apelido.test(base)) return PRATELEIRAS[i].id;
    return null;
  }
  /* "QRY0390_parte2.csv" → 2. Sem "parte" no nome → 0 (arquivo inteiro). */
  function parteDe(nome){
    var m = /parte\s*[_-]?\s*(\d+)/i.exec(String(nome || ''));
    return m ? parseInt(m[1], 10) : 0;
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
      var prat = EXTENSOES.test(f.name) ? classificar(f.name) : null;
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
          if(EXTENSOES.test(h.name) && classificar(h.name)) naPasta.push(h);
          else if(!/^~\$|^\.|desktop\.ini$/i.test(h.name)) ignorados.push(h.name);
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
      prateleira: POR_ID[id],
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
      return PRATELEIRAS.map(function(p){ return montarPacote(p.id, l); });
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

  window.LDM_ALMOX = {
    PRATELEIRAS: PRATELEIRAS,
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
