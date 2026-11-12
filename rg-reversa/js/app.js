/* RG Reversa — recomeço do zero: só o plano de fundo (menu, tema e zoom). */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }

var SUN='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
var MOON='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
/* Mesmas chaves do Painel Oficina LDM (raiz): o tema e o zoom escolhidos lá valem aqui. */
function aplicaTema(escuro){
  document.documentElement.setAttribute('data-theme', escuro?'dark':'light');
  var b=$('themeSwitchBtn'); b.classList.toggle('on',escuro); b.querySelector('.theme-knob').innerHTML=escuro?MOON:SUN;
}
function temaEscuro(){ try { return localStorage.getItem('ldm-theme')==='dark'; } catch(e){ return false; } }
function aplicaZoom(p){
  p=Math.max(70,Math.min(150,p));
  document.body.style.zoom=p/100;
  document.documentElement.style.setProperty('--zoom',p/100);
  $('zoomLabel').textContent=p+'%';
  try { localStorage.setItem('ldm-zoom',p); } catch(e){}
  return p;
}
function zoomAtual(){ try { return parseInt(localStorage.getItem('ldm-zoom'),10)||100; } catch(e){ return 100; } }


document.addEventListener('click', function(ev){
  var el=ev.target.closest('[data-act]'); if(!el) return;
  var a=el.dataset.act;
  if(a==='sidebar'){ var sb=$('sidebar'); return sb.classList.toggle(matchMedia('(max-width:640px)').matches?'mobile-open':'collapsed'); }
  if(a==='fecha-sidebar') return $('sidebar').classList.remove('mobile-open');
  if(a==='tema'){ var e=!temaEscuro(); try { localStorage.setItem('ldm-theme',e?'dark':'light'); } catch(x){} return aplicaTema(e); }
  if(a==='zoom-mais') return aplicaZoom(zoomAtual()+10);
  if(a==='zoom-menos') return aplicaZoom(zoomAtual()-10);
});
$('brandLogo').addEventListener('click', function(){ this.classList.remove('spin'); void this.offsetWidth; this.classList.add('spin'); });
aplicaTema(temaEscuro());
aplicaZoom(zoomAtual());
var v=$('sidebarVersao');
if(v && window.LDM_BUILD && window.LDM_BUILD.data && window.LDM_BUILD.data!=='—') v.textContent='Atualizado em '+window.LDM_BUILD.data;
})();
