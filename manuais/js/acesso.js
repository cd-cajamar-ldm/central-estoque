/* ============================================================
   Trava de acesso real (mesmo padrão do Inventário, Múltiplos e Validade).
   Mesmo projeto Supabase de Tarefas/Projetos ("Estoque Project"), schema
   "acessos" (ver supabase-acessos/ na raiz do repositório). Só entra quem
   o administrador cadastrou em Configurações (hub) com permissão pra este
   app — o bloqueio é checado pelo banco (RLS), não só aqui no navegador.
   ============================================================ */
const LDM_APP_KEY = 'manuais';
const LDM_SUPA_URL = 'https://jfvnswafpeshyfweoadg.supabase.co';
const LDM_SUPA_ANON = 'sb_publishable_x1ioDmPDsDZdTgcq6SOCGw_PlJeIw_m';

window.ldmSupa = window.supabase.createClient(LDM_SUPA_URL, LDM_SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function ldmAcessoEmPortugues(msg){
  const m = String(msg || '').toLowerCase();
  if(m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if(m.includes('email not confirmed')) return 'Confirme o e-mail pelo link que o Supabase enviou e tente de novo.';
  if(m.includes('user already registered')) return 'Este e-mail já tem acesso criado. Use "Já tenho acesso".';
  if(m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if(m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Espere alguns minutos.';
  return msg || 'Não consegui completar a operação.';
}

/* Evita a tela travar pra sempre: às vezes o navegador fica esperando outra
   aba de um app da Oficina LDM (mesmo projeto Supabase, mesma sessão)
   liberar o login. Depois desse tempo, desiste e explica em vez de travar
   sem nenhuma mensagem. */
function comLimite(promessa, segundos){
  return Promise.race([
    promessa,
    new Promise(function(_, rejeitar){
      setTimeout(function(){
        rejeitar(new Error('Demorou demais pra responder. Feche as outras abas de apps da Oficina LDM e tente de novo.'));
      }, segundos * 1000);
    })
  ]);
}

(function(){
  const telaAcesso = document.getElementById('telaAcesso');
  const telaLogin = document.getElementById('acessoLogin');
  const telaNegado = document.getElementById('acessoNegado');
  const form = document.getElementById('acessoForm');
  const emailEl = document.getElementById('acessoEmail');
  const senhaEl = document.getElementById('acessoSenha');
  const senhaCampo = document.getElementById('acessoSenhaCampo');
  const mostrarBtn = document.getElementById('acessoMostrarSenha');
  const erroEl = document.getElementById('acessoErro');
  const recadoEl = document.getElementById('acessoRecado');
  const enviarBtn = document.getElementById('acessoEnviar');
  const modoCriarBtn = document.getElementById('acessoModoCriar');
  const modoEntrarBtn = document.getElementById('acessoModoEntrar');
  const modoRecuperarBtn = document.getElementById('acessoModoRecuperar');
  const negadoEmailEl = document.getElementById('acessoNegadoEmail');
  const sairNegadoBtn = document.getElementById('acessoSairNegado');
  const sairSidebarBtn = document.getElementById('sidebarSairBtn');

  let modo = 'entrar';
  let appIniciado = false;

  function mostrarModo(novoModo){
    modo = novoModo;
    senhaCampo.hidden = modo === 'recuperar';
    enviarBtn.textContent = modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar acesso' : 'Enviar link de troca de senha';
    modoEntrarBtn.hidden = modo === 'entrar';
    modoCriarBtn.hidden = modo === 'criar';
    modoRecuperarBtn.hidden = modo === 'recuperar';
    erroEl.hidden = true;
    recadoEl.hidden = true;
  }
  modoEntrarBtn.addEventListener('click', function(){ mostrarModo('entrar'); });
  modoCriarBtn.addEventListener('click', function(){ mostrarModo('criar'); });
  modoRecuperarBtn.addEventListener('click', function(){ mostrarModo('recuperar'); });
  mostrarBtn.addEventListener('click', function(){
    const oculto = senhaEl.type === 'password';
    senhaEl.type = oculto ? 'text' : 'password';
    mostrarBtn.textContent = oculto ? 'Ocultar' : 'Mostrar';
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    erroEl.hidden = true; recadoEl.hidden = true;
    enviarBtn.disabled = true;
    const email = emailEl.value.trim().toLowerCase();
    const senha = senhaEl.value;
    try {
      if(modo === 'entrar'){
        const { error } = await comLimite(ldmSupa.auth.signInWithPassword({ email: email, password: senha }), 12);
        if(error) throw error;
      } else if(modo === 'criar'){
        const { error } = await comLimite(ldmSupa.auth.signUp({ email: email, password: senha }), 12);
        if(error) throw error;
        recadoEl.textContent = 'Acesso criado. Se o e-mail já estiver liberado pro administrador, você já entra; senão, peça pra ele te cadastrar em Configurações.';
        recadoEl.hidden = false;
      } else {
        const { error } = await comLimite(ldmSupa.auth.resetPasswordForEmail(email, { redirectTo: window.location.href }), 12);
        if(error) throw error;
        recadoEl.textContent = 'Se este e-mail tiver acesso, o link de troca de senha chega em instantes.';
        recadoEl.hidden = false;
      }
      await ldmVerificarAcesso();
    } catch(falha){
      erroEl.textContent = ldmAcessoEmPortugues(falha && falha.message);
      erroEl.hidden = false;
    } finally {
      enviarBtn.disabled = false;
    }
  });

  sairNegadoBtn.addEventListener('click', function(){ ldmSupa.auth.signOut().then(ldmVerificarAcesso); });
  if(sairSidebarBtn) sairSidebarBtn.addEventListener('click', function(){ ldmSupa.auth.signOut().then(ldmVerificarAcesso); });

  /* Abre o app (uma vez só). */
  function iniciarApp(){
    if(appIniciado) return;
      appIniciado = true;
      /* Registra a visita pra contar na frequência (Configurações do hub).
         Não bloqueia o app por causa disso — se falhar, só não conta. */
      ldmSupa.rpc('ldm_registrar_acesso', { p_app_key: LDM_APP_KEY }).then(function(){}, function(){});
      /* O app abre JÁ; o nível de acesso e a sincronização vêm em seguida. */
      if(typeof window.LDM_INICIAR === 'function') window.LDM_INICIAR();
      /* 'visualizar': lê os dados do servidor, mas não grava (o banco também recusa). */
      ldmSupa.rpc('ldm_nivel_acesso', { p_app_key: LDM_APP_KEY }).then(function(r){
        if(r && r.data === 'visualizar'){ window.LDM_SOMENTE_LEITURA = true; document.documentElement.classList.add('somente-leitura'); }
      }).catch(function(){}).then(function(){
        if(window.LDM_NUVEM && window.LDM_NUVEM_CFG) setTimeout(function(){ window.LDM_NUVEM.iniciar(window.LDM_NUVEM_CFG); }, 1200);
      });
  }


  /* Falha de conexão NÃO é "sem permissão". Antes, um tropeço de rede logo depois
     de uma atualização virava "Acesso negado" com um único botão — Sair —, que
     deslogava a pessoa. Agora: tenta de novo sozinho; se a última checagem OK da
     mesma pessoa foi há menos de 24 h, abre o app (o banco continua protegendo os
     dados) e segue conferindo; só então mostra o aviso com "Tentar de novo". */
  const LDM_OK_KEY = 'ldm-acesso-ok-' + LDM_APP_KEY;
  const ldmTextoNegadoEl = document.getElementById('acessoNegadoTexto');
  const ldmTextoNegadoOriginal = ldmTextoNegadoEl ? ldmTextoNegadoEl.innerHTML : '';
  const ldmTentarBtn = document.getElementById('acessoTentarDeNovo');
  if(ldmTentarBtn) ldmTentarBtn.addEventListener('click', function(){ ldmTentarBtn.disabled = true; Promise.resolve(ldmVerificarAcesso()).finally(function(){ ldmTentarBtn.disabled = false; }); });
  function ldmOkRecente(uid){ try{ const o = JSON.parse(localStorage.getItem(LDM_OK_KEY)||'null'); return !!(o && o.uid===uid && Date.now()-o.em < 24*3600*1000); }catch(e){ return false; } }
  function ldmMarcarOk(uid){ try{ localStorage.setItem(LDM_OK_KEY, JSON.stringify({uid:uid, em:Date.now()})); }catch(e){} }
  async function ldmChecarPermissao(){
    let ultimo = null;
    for(const atraso of [0, 1500, 3500]){
      if(atraso) await new Promise(function(r){ setTimeout(r, atraso); });
      try{
        const r = await comLimite(ldmSupa.rpc('ldm_pode_acessar', { p_app_key: LDM_APP_KEY }), 12);
        if(!r.error) return {pode: !!r.data};
        ultimo = r.error;
      }catch(e){ ultimo = e; }
    }
    return {erro: ultimo};
  }
  function ldmMostrarFalha(){
    telaLogin.hidden = true; telaNegado.hidden = false;
    if(ldmTextoNegadoEl) ldmTextoNegadoEl.textContent = 'Não consegui confirmar seu acesso agora (falha de conexão). Seu login continua salvo — clique em "Tentar de novo".';
    if(ldmTentarBtn) ldmTentarBtn.hidden = false;
    telaAcesso.classList.remove('escondida');
  }

  async function ldmVerificarAcesso(){
    let session = null;
    try{ session = (await comLimite(ldmSupa.auth.getSession(), 10)).data.session; }
    catch(e){ if(appIniciado) return; ldmMostrarFalha(); return; }
    if(!session){
      telaLogin.hidden = false; telaNegado.hidden = true;
      telaAcesso.classList.remove('escondida');
      return;
    }
    const r = await ldmChecarPermissao();
    if(r.erro){
      if(appIniciado) return;   /* checagem periódica sem conexão: não derruba quem já está usando */
      if(ldmOkRecente(session.user.id)){ telaAcesso.classList.add('escondida'); iniciarApp(); return; }
      ldmMostrarFalha();
      return;
    }
    if(!r.pode){
      try{ localStorage.removeItem(LDM_OK_KEY); }catch(e){}
      telaLogin.hidden = true; telaNegado.hidden = false;
      if(ldmTextoNegadoEl) ldmTextoNegadoEl.innerHTML = ldmTextoNegadoOriginal;
      if(ldmTentarBtn) ldmTentarBtn.hidden = true;
      const emailEl = document.getElementById('acessoNegadoEmail'); if(emailEl) emailEl.textContent = session.user.email;
      telaAcesso.classList.remove('escondida');
      return;
    }
    ldmMarcarOk(session.user.id);
    telaAcesso.classList.add('escondida');
    iniciarApp();
  }

  /* Retirou o acesso de alguém? A permissão é conferida de novo a cada minuto (e ao voltar para a aba): a tela de
     bloqueio volta sozinha, sem a pessoa precisar sair e entrar. */
  setInterval(function(){ if(appIniciado && !document.hidden) ldmVerificarAcesso(); }, 60000);
  document.addEventListener('visibilitychange', function(){ if(appIniciado && !document.hidden) ldmVerificarAcesso(); });

  ldmSupa.auth.onAuthStateChange(function(){ ldmVerificarAcesso(); });
  ldmVerificarAcesso();
})();
