/* Coletor de mão — RG Reversa.
 * Fluxo: bipa o local de origem → bipa cada RG (um por linha, numerados) → bipa o local de destino → Finalizar.
 * O destino pode ser bipado no próprio campo de RG: RG tem 16 dígitos (ano, mês, dia, filial e sequência do dia) e
 * local tem no máximo 12, então o app reconhece o local e preenche o destino. Quem finaliza é a pessoa, no botão.
 * Ao finalizar, abre a tela do relatório (origem · RG · destino): a pessoa copia, faz a movimentação no WMS e
 * toca em "Finalizar movimentação" para voltar à tela do coletor. O Excel é opcional (botão). Nada é importado aqui: o nome do local vem da lista que o dashboard
 * mantém no Supabase (public.rg_locais) e que o aparelho guarda para funcionar até sem internet. */
(function(){
'use strict';

var PEND_KEY = 'rg-reversa-pend';
var HIST_KEY = 'rg-reversa-coletor-hist', HIST_MAX_LOTES = 60, HIST_MAX_RGS = 5000;
var S = { user:'', teclado:false, col:null, avisoLista:'', tela:'coletor', histAberto:'' };

function $(id){ return document.getElementById(id); }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function d2(n){ return (n<10?'0':'')+n; }
function int(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k)||'[]'); } catch(e){ return []; } }
function lsSet(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function toast(msg, erro){
  var el=$('toast'); el.textContent=msg; el.className='cl-toast'+(erro?' erro':''); el.hidden=false;
  clearTimeout(toast.t); toast.t=setTimeout(function(){ el.hidden=true; }, erro?6000:3000);
}
var audio=null;
function bip(ok){
  try {
    audio=audio||new (window.AudioContext||window.webkitAudioContext)();
    var o=audio.createOscillator(), g=audio.createGain(); o.connect(g); g.connect(audio.destination);
    o.frequency.value=ok?880:220; o.type=ok?'sine':'square'; g.gain.value=.08; o.start(); o.stop(audio.currentTime+(ok?.08:.28));
  } catch(e){}
  try { if(navigator.vibrate) navigator.vibrate(ok?30:[80,60,80]); } catch(e){}
}
function pendentes(){ return lsGet(PEND_KEY); }
function novo(ultimo, hist, rel){ return { origem:'', rgs:[], destino:'', msg:'', erro:false, ultimo:ultimo||'', hist:hist||[], rel:rel||null, relAberto:false, salvando:false, foco:'origem' }; }

/* ---------- tela ---------- */
function nomeBox(raw){
  var cod=RG.localNorm(raw), x=RG.nomeLocal(raw);
  if(x && x.d) return '<div class="cl-nome"><b>'+esc(x.d)+'</b><small>'+esc(x.c)+'</small></div>';
  return '<div class="cl-nome sem"><b>'+(RG.locais.mapa.size?'Local não encontrado na lista':'Lista de locais ainda não carregada')+'</b><small>código '+esc(cod)+'</small></div>';
}
function campo(id, ph, c, onde, desligado){
  return '<input class="cl-in'+(c.erro&&c.foco===onde?' err':'')+'" id="'+id+'" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="'+ph+'"'+(S.teclado?'':' inputmode="none"')+(desligado?' disabled':'')+'>';
}
/* ---------- histórico de transferências (guardado no aparelho) ---------- */
function guardaHist(rel){
  var l=lsGet(HIST_KEY);
  l.unshift({ lote:rel.lote, ts:Date.now(), data:rel.data, hora:rel.hora, origem:rel.origem, destino:rel.destino, rgs:rel.rgs.map(function(r){ return r.rg; }) });
  var tot=0, out=[];
  l.forEach(function(x){ if(out.length<HIST_MAX_LOTES && (tot+x.rgs.length<=HIST_MAX_RGS || !out.length)){ out.push(x); tot+=x.rgs.length; } });
  lsSet(HIST_KEY,out);
}
function textoLote(x){
  return RG.textoPutty(RG.linhasBlocos([{ origem:x.origem, destino:x.destino, rgs:x.rgs.map(function(r){ return {rg:r}; }) }]));
}
function viewHist(){
  var lista=lsGet(HIST_KEY), pend=pendentes(), tot=lista.reduce(function(s,x){ return s+x.rgs.length; },0), h='';
  h+='<div class="cl-box cl-hbox"><div class="cl-rel-h"><b>Histórico de transferências</b><span class="cl-rel-n">'+int(lista.length)+' lote'+(lista.length===1?'':'s')+' · '+int(tot)+' RGs</span></div>'+
    '<div class="cl-btns"><button class="cl-pri" data-act="h-copy-all"'+(lista.length?'':' disabled')+'>📋 Copiar tudo</button><button class="cl-sec" data-act="h-voltar">← Voltar</button></div></div>';
  if(!lista.length) h+='<div class="cl-vazio">Nenhuma transferência registrada neste aparelho ainda.</div>';
  lista.forEach(function(x){
    var aberto=S.histAberto===x.lote, naoEnv=pend.some(function(p){ return p.lote===x.lote; });
    h+='<div class="cl-box cl-hitem"><div class="cl-hit-top"><b>'+esc(x.hora)+'</b><span>'+esc(x.data)+'</span>'+(naoEnv?'<em class="cl-hit-pend">não enviado</em>':'')+'<span class="cl-rel-n">'+x.rgs.length+' RG'+(x.rgs.length===1?'':'s')+'</span></div>'+
      '<div class="cl-rel-rota"><b>'+esc(RG.localNorm(x.origem))+'</b><span>→</span><b>'+esc(RG.localNorm(x.destino))+'</b></div>'+
      '<div class="cl-btns"><button class="cl-sec" data-act="h-ver" data-l="'+esc(x.lote)+'">'+(aberto?'Ocultar RGs':'Ver RGs')+'</button><button class="cl-pri" data-act="h-copy" data-l="'+esc(x.lote)+'">📋 Copiar</button></div>'+
      (aberto?'<div class="cl-tabw"><table class="cl-tab"><thead><tr><th>#</th><th>RG</th></tr></thead><tbody>'+x.rgs.map(function(r,i){ return '<tr><td>'+(i+1)+'</td><td class="rg">'+esc(r)+'</td></tr>'; }).join('')+'</tbody></table></div>':'')+'</div>';
  });
  return h;
}
function view(){
  if(S.tela==='hist') return viewHist();
  var c=S.col, pend=pendentes(), h='';
  if(pend.length) h+='<div class="cl-pend"><span>⚠ <b>'+int(pend.reduce(function(s,p){ return s+p.rows.length; },0))+'</b> bipagens aguardando envio.</span><button data-act="sync">Enviar</button></div>';
  /* Relatório da movimentação que acabou de ser finalizada: copiar → movimentar no WMS → Finalizar movimentação. */
  var rel=c.relAberto ? c.rel : null;
  if(rel){
    var n=rel.rgs.length;
    h+='<div class="cl-box on cl-relbox"><div class="cl-rel-h"><b>✔ Movimentação registrada</b><span class="cl-rel-n">'+int(n)+' RG'+(n===1?'':'s')+' · '+esc(rel.hora)+'</span></div>'+
      '<div class="cl-rel-rota"><b>'+esc(RG.localNorm(rel.origem))+'</b><span>→</span><b>'+esc(RG.localNorm(rel.destino))+'</b></div>'+
      (rel.salvo?'':'<div class="cl-msg bad" style="margin-bottom:8px">Sem conexão: o histórico será enviado depois.</div>')+
      '<button class="cl-pri cl-copiar'+(rel.usado?' feito':'')+'" data-act="rel-copy">'+(rel.usado?'✔ Copiado — copiar de novo':'📋 Copiar relatório')+'</button>'+
      '<div class="cl-tabw"><table class="cl-tab"><thead><tr><th>Local de origem</th><th>RG</th><th>Local de destino</th></tr></thead><tbody>'+
      rel.rgs.map(function(r){ return '<tr><td>'+esc(RG.localNorm(rel.origem))+'</td><td class="rg">'+esc(r.rg)+'</td><td>'+esc(RG.localNorm(rel.destino))+'</td></tr>'; }).join('')+'</tbody></table></div>'+
      '<button class="cl-lnk" data-act="rel-xlsx">⬇ Baixar Excel (opcional)</button></div>'+
      '<button class="cl-final cl-fim" id="clFim" data-act="fim-mov">✔ Finalizar movimentação</button>';
  } else {
    var pode=c.origem && c.rgs.length && c.destino && !c.salvando;
    /* 1 · origem */
    h+='<div class="cl-box'+(c.origem?' ok':' on')+'"><label for="clOrigem"><span class="cl-n">1</span>Local de origem</label>';
    if(c.origem) h+='<div class="cl-lock"><b>'+esc(RG.localNorm(c.origem))+'</b><button data-act="trocar-o" aria-label="Trocar origem">✎</button></div>'+nomeBox(c.origem);
    else h+=campo('clOrigem','bipe o local de origem',c,'origem');
    h+='</div>';
    /* 2 · RGs */
    h+='<div class="cl-box'+(c.origem?(c.rgs.length?' ok':' on'):' off')+'"><label for="clRg"><span class="cl-n">2</span>RGs<span class="cl-qtd">Qtd <b>'+c.rgs.length+'</b></span></label>'+campo('clRg','bipe o RG ou o destino',c,'rg',!c.origem)+
      '<div class="cl-list" id="clList">'+(c.rgs.length?c.rgs.map(function(r,i){ return '<div class="cl-li"><span>'+(i+1)+'</span><b>'+esc(r.rg)+'</b><button data-act="del" data-i="'+i+'" aria-label="Remover">✕</button></div>'; }).join(''):'<div class="cl-vazio">Os RGs bipados aparecem aqui, um por linha.</div>')+'</div>'+
      '</div>';
    /* 3 · destino */
    h+='<div class="cl-box'+(c.destino?' ok':(c.rgs.length?' on':' off'))+'"><label for="clDestino"><span class="cl-n">3</span>Local de destino</label>';
    if(c.destino) h+='<div class="cl-lock"><b>'+esc(RG.localNorm(c.destino))+'</b><button data-act="trocar-d" aria-label="Trocar destino">✎</button></div>'+nomeBox(c.destino);
    else h+=campo('clDestino','bipe o local de destino',c,'destino',!c.rgs.length);
    h+='</div>';
    if(c.msg) h+='<div class="cl-msg'+(c.erro?' bad':'')+'">'+esc(c.msg)+'</div>';
    h+='<button class="cl-final" id="clFinal" data-act="final"'+(pode?'':' disabled')+'>'+(c.salvando?'Salvando…':'✔ Finalizar')+'</button>';
    if(c.origem||c.rgs.length||c.destino) h+='<button class="cl-lnk" data-act="cancela">Cancelar e recomeçar</button>';
  }
  if(c.hist.length) h+='<div class="cl-hist"><div class="cl-hist-t">Enviadas nesta sessão</div>'+c.hist.slice(0,3).map(function(x){ return '<div>'+esc(x)+'</div>'; }).join('')+'</div>';
  if(S.avisoLista) h+='<div class="cl-info">'+esc(S.avisoLista)+'</div>';
  return h;
}
function render(){
  $('app').innerHTML=view();
  var l=$('clList'); if(l) l.scrollTop=l.scrollHeight;
  foco();
}
function foco(){
  var c=S.col, id = c.foco==='final' ? 'clFinal' : c.foco==='destino' ? 'clDestino' : c.foco==='rg' ? 'clRg' : 'clOrigem';
  var el=$(id); if(el && !el.disabled) el.focus();
}
function erro(msg, onde){ var c=S.col; c.erro=true; c.msg=msg; c.foco=onde; bip(false); render(); }

/* ---------- bipagem ---------- */
function commit(campoNome, el){
  var c=S.col, v=el.value.trim(); if(!v) return;
  c.erro=false; c.msg='';
  if(campoNome==='origem'){ c.origem=v; c.rel=null; c.foco='rg'; bip(true); return render(); }
  if(campoNome==='destino'){
    if(RG.localCodigo(v)===RG.localCodigo(c.origem)){ el.value=''; return erro('O destino é igual à origem.','destino'); }
    c.destino=v; c.foco='final'; bip(true); return render();
  }
  var rg=String(v).replace(/[^0-9A-Za-z]/g,'');   /* o leitor às vezes manda um "+" ou outro símbolo na frente */
  if(!rg){ el.value=''; return; }
  /* Local ou RG? RG tem 16 dígitos; local tem no máximo 12 (6 ou 7 do WMS, 10 da etiqueta, 12 com zeros na frente).
     Quem bipa o local de destino no campo de RG já preenche o destino, sem tocar no outro campo; o Finalizar fica a cargo da pessoa. */
  if(/^\d{5,12}$/.test(rg)){
    if(!c.rgs.length){ el.value=''; return erro('Bipe pelo menos um RG antes do local de destino.','rg'); }
    if(RG.localCodigo(rg)===RG.localCodigo(c.origem)){ el.value=''; return erro('O destino é igual à origem.','rg'); }
    c.destino=v; c.foco='final'; bip(true); return render();
  }
  if(c.rgs.some(function(r){ return r.rg===rg; })){ el.value=''; return erro('RG '+rg+' já foi bipado neste palete.','rg'); }
  c.rgs.push({rg:rg}); c.foco='rg'; bip(true); render();
}

/* ---------- envio ---------- */
function enviaLote(rows){
  var partes=[]; for(var i=0;i<rows.length;i+=500) partes.push(rows.slice(i,i+500));
  return partes.reduce(function(p,parte){
    return p.then(function(){ return window.rgSupa.from('rg_movimentacoes').insert(parte).then(function(r){ if(r.error) throw r.error; }); });
  }, Promise.resolve());
}
function sync(){
  var p=pendentes(); if(!p.length) return;
  var resto=[], seq=Promise.resolve();
  p.forEach(function(l){ seq=seq.then(function(){ return enviaLote(l.rows).catch(function(){ resto.push(l); }); }); });
  seq.then(function(){ lsSet(PEND_KEY,resto); toast(resto.length?'Ainda sem conexão para '+resto.length+' lote(s).':'Tudo enviado.', !!resto.length); render(); });
}
function finaliza(){
  var c=S.col; if(!c.origem || !c.destino || !c.rgs.length || c.salvando) return;
  c.salvando=true; render();
  var lote=(window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'l'+Date.now()+Math.random().toString(16).slice(2);
  var quando=new Date().toISOString();
  var rows=c.rgs.map(function(r){ return { lote:lote, criado_em:quando, operador:S.user, local_origem:c.origem, rg:r.rg, local_destino:c.destino }; });
  var resumo=c.rgs.length+' RGs · '+RG.localNorm(c.origem)+' → '+RG.localNorm(c.destino), hora=d2(new Date().getHours())+':'+d2(new Date().getMinutes());
  var ultimo='', hist=c.hist, rel={ lote:lote, hora:hora, origem:c.origem, destino:c.destino, rgs:c.rgs.slice(), salvo:false, data:new Date().toLocaleDateString('pt-BR') };
  guardaHist(rel);
  enviaLote(rows).then(function(){ hist.unshift(hora+' · '+resumo); rel.salvo=true; toast('Movimentação salva: '+resumo); }).catch(function(){
    var p=pendentes(); p.push({lote:lote, rows:rows}); lsSet(PEND_KEY,p);
    hist.unshift(hora+' · '+resumo+' (pendente)'); toast('Sem conexão — guardei no aparelho e envio depois.', true);
  }).then(function(){
    S.col=novo(ultimo, hist, rel); S.col.relAberto=true; S.col.foco='nenhum'; render();
    var sc=document.querySelector('.cl-scroll'); if(sc) sc.scrollTop=0;   /* abre o relatório pelo topo */
  });
}

/* ---------- relatório ---------- */
function blocoRel(r){ return { origem:r.origem, destino:r.destino, rgs:r.rgs, hora:r.hora, operador:S.user }; }
function xlsx(){
  var r=S.col.rel; if(!r) return;
  RG.xlsx([blocoRel(r)], { data:r.data+' '+r.hora, operador:S.user }, 'rg-reversa-movimentacao-'+r.hora.replace(':','h')+'-'+Date.now().toString(36)+'.xlsx');
  r.usado=true; marca(r); render();
}
function copia(){
  var r=S.col.rel; if(!r) return;
  var linhas=RG.linhasBlocos([blocoRel(r)]);
  RG.copia(RG.textoPutty(linhas)).then(function(){ r.usado=true; toast(int(linhas.length)+' linhas copiadas — cole no PuTTY.'); marca(r); render(); });
}
/* Exportou o relatório: marca o lote como exportado (se já chegou ao banco). */
function marca(r){
  if(!r.salvo || r.marcado) return; r.marcado=true;
  window.rgSupa.from('rg_movimentacoes').update({ exportado_em:new Date().toISOString() }).eq('lote', r.lote).then(function(){});
}

/* ---------- lista de locais ---------- */
function carregaLista(force){
  S.avisoLista='Atualizando lista de locais…'; if(S.col) render();
  return RG.carregaLocais(window.rgSupa, force).then(function(r){
    S.avisoLista = r.erro ? 'Lista de locais: '+int(r.n)+' no aparelho (sem atualizar: '+r.erro+')' : 'Lista de locais: '+int(r.n)+' ('+(r.de==='servidor'?'atualizada agora':'do aparelho')+')';
    if(!r.n) S.avisoLista='Lista de locais vazia — importe a QRY0390 no dashboard para os nomes aparecerem.';
    render();
  });
}

/* ---------- eventos ---------- */
document.addEventListener('click', function(ev){
  var el=ev.target.closest('[data-act]'); if(!el) return;
  var a=el.dataset.act, c=S.col;
  if(a==='trocar-o'){ c.origem=''; c.msg=''; c.erro=false; c.foco='origem'; return render(); }
  if(a==='trocar-d'){ c.destino=''; c.msg=''; c.erro=false; c.foco='destino'; return render(); }
  if(a==='del'){ c.rgs.splice(+el.dataset.i,1); c.foco='rg'; return render(); }
  if(a==='cancela'){ if(c.rgs.length && !confirm('Descartar esta bipagem?')) return; S.col=novo(c.ultimo, c.hist, c.rel); return render(); }
  if(a==='final') return finaliza();
  if(a==='sync') return sync();
  if(a==='rel-xlsx') return xlsx();
  if(a==='h-voltar'){ S.tela='coletor'; $('clHist').classList.remove('on'); return render(); }
  if(a==='h-ver'){ S.histAberto = S.histAberto===el.dataset.l ? '' : el.dataset.l; return render(); }
  if(a==='h-copy'){
    var x=lsGet(HIST_KEY).filter(function(y){ return y.lote===el.dataset.l; })[0]; if(!x) return;
    return RG.copia(textoLote(x)).then(function(){ toast(x.rgs.length+' linhas copiadas.'); });
  }
  if(a==='h-copy-all'){
    var todos=lsGet(HIST_KEY); if(!todos.length) return;
    return RG.copia(todos.map(textoLote).join('')).then(function(){ toast(todos.reduce(function(s,y){ return s+y.rgs.length; },0)+' linhas copiadas.'); });
  }
  if(a==='rel-copy') return copia();
  if(a==='fim-mov'){
    if(c.rel && !c.rel.usado && !confirm('Você ainda não copiou o relatório. Finalizar mesmo assim?')) return;
    c.relAberto=false; c.rel=null; c.foco='origem'; toast('Pronto para a próxima movimentação.'); return render();
  }
});
var timer;
document.addEventListener('input', function(ev){
  var t=ev.target;
  /* O leitor de RG não manda Enter: o código entra sozinho quando a digitação para (leitor é rápido). */
  if(t.id==='clRg'){ clearTimeout(timer); timer=setTimeout(function(){ if(t.value.trim().length>=3 && document.activeElement===t) commit('rg', t); }, 280); }
});
document.addEventListener('keydown', function(ev){
  var t=ev.target;
  if((t.id==='clOrigem' || t.id==='clDestino' || t.id==='clRg') && ev.key==='Enter'){
    ev.preventDefault(); clearTimeout(timer);
    commit(t.id==='clOrigem'?'origem':t.id==='clDestino'?'destino':'rg', t);
  }
});
$('clTeclado').addEventListener('click', function(){ S.teclado=!S.teclado; this.classList.toggle('on',S.teclado); render(); });
$('clSync').addEventListener('click', function(){ carregaLista(true); });
$('clHist').addEventListener('click', function(){ S.tela = S.tela==='hist' ? 'coletor' : 'hist'; this.classList.toggle('on', S.tela==='hist'); render(); var sc=document.querySelector('.cl-scroll'); if(sc) sc.scrollTop=0; });
/* o leitor às vezes tira o foco ao tocar na tela: um toque fora dos campos devolve o foco ao campo da vez */
document.addEventListener('click', function(ev){ if(!ev.target.closest('button,input,a')) foco(); });

$('clVersao').textContent=RG.versaoTxt();
S.col=novo();
render();
RG.vigiaVersao('../js/versao.js');
(function relogio(){ var el=$('clHora'); function t(){ var d=new Date(); if(el) el.textContent=d2(d.getHours())+':'+d2(d.getMinutes()); } t(); setInterval(t,20000); })();

/* Chamado pela trava de acesso (../js/acesso.js) depois que o login e a permissão passam. */
var iniciado=false;
window.rgIniciar=function(){
  if(iniciado) return; iniciado=true;
  try { window.rgSupa.auth.getSession().then(function(r){ var u=r.data && r.data.session && r.data.session.user; S.user=u&&u.email ? u.email.split('@')[0] : ''; }); } catch(e){}
  render(); carregaLista(false);
  if(pendentes().length) sync();
};
})();
