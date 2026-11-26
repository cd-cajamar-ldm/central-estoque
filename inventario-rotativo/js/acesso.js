/* ============================================================
   Inventário Rotativo — trava de acesso real.
   Mesmo projeto Supabase de Tarefas/Projetos ("Estoque Project"), schema
   "acessos" (ver supabase-acessos/ na raiz do repositório). Só entra quem
   o administrador cadastrou em Configurações (hub) com permissão pra este
   app — o bloqueio é checado pelo banco (RLS), não só aqui no navegador.
   ============================================================ */
const IRA_APP_KEY = 'inventario';
const IRA_SUPA_URL = 'https://jfvnswafpeshyfweoadg.supabase.co';
const IRA_SUPA_ANON = 'sb_publishable_x1ioDmPDsDZdTgcq6SOCGw_PlJeIw_m';

const irSupa = window.supabase.createClient(IRA_SUPA_URL, IRA_SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function irAcessoEmPortugues(msg){
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
        const { error } = await comLimite(irSupa.auth.signInWithPassword({ email: email, password: senha }), 12);
        if(error) throw error;
      } else if(modo === 'criar'){
        const { error } = await comLimite(irSupa.auth.signUp({ email: email, password: senha }), 12);
        if(error) throw error;
        recadoEl.textContent = 'Acesso criado. Se o e-mail já estiver liberado pro administrador, você já entra; senão, peça pra ele te cadastrar em Configurações.';
        recadoEl.hidden = false;
      } else {
        const { error } = await comLimite(irSupa.auth.resetPasswordForEmail(email, { redirectTo: window.location.href }), 12);
        if(error) throw error;
        recadoEl.textContent = 'Se este e-mail tiver acesso, o link de troca de senha chega em instantes.';
        recadoEl.hidden = false;
      }
      await irVerificarAcesso();
    } catch(falha){
      erroEl.textContent = irAcessoEmPortugues(falha && falha.message);
      erroEl.hidden = false;
    } finally {
      enviarBtn.disabled = false;
    }
  });

  sairNegadoBtn.addEventListener('click', function(){ irSupa.auth.signOut().then(irVerificarAcesso); });
  if(sairSidebarBtn) sairSidebarBtn.addEventListener('click', function(){ irSupa.auth.signOut().then(irVerificarAcesso); });

  /* Abre o app (uma vez só). */
  function iniciarApp(){
    if(appIniciado) return;
      appIniciado = true;
      /* O app abre JÁ, sem esperar o banco. Esperar a consulta do nível antes
         de irInit() deixava a tela presa em "Carregando..." quando a chamada
         não voltava (ex.: disparada de dentro do aviso de login do Supabase,
         que segura a conexão até o aviso terminar). */
      irInit();
      /* Nível de acesso: 'visualizar' esconde importação/configuração e não
         grava na nuvem (o banco também recusa). Se a consulta falhar ou
         demorar, segue como editor — quem decide de verdade é o banco. */
      irSupa.rpc('ldm_nivel_acesso', { p_app_key: IRA_APP_KEY }).then(function(r){
        if(r && r.data === 'visualizar'){
          window.LDM_SOMENTE_LEITURA = true;
          document.documentElement.classList.add('somente-leitura');
        }
      }).catch(function(){});
      /* Registra a visita pra contar na frequência (Configurações do hub).
         Não bloqueia o app por causa disso — se falhar, só não conta. */
      irSupa.rpc('ldm_registrar_acesso', { p_app_key: IRA_APP_KEY }).then(function(){}, function(){});
  }

  /* Falha de conexão NÃO é "sem permissão". Antes, um tropeço de rede logo
     depois de uma atualização (o app recarrega, a conexão oscila) virava
     "Acesso negado" com um único botão — Sair —, que deslogava a pessoa e a
     mandava para o login do zero. Agora:
       1. tenta de novo sozinho algumas vezes;
       2. se a última checagem OK desta pessoa foi há menos de 24 h, abre o app
          (os dados continuam protegidos pelo banco) e segue checando;
       3. só então mostra o aviso, com "Tentar de novo" (Sair continua lá). */
  const IRA_OK_KEY = 'ira-acesso-ok';
  const textoNegadoEl = document.getElementById('acessoNegadoTexto');
  const textoNegadoOriginal = textoNegadoEl ? textoNegadoEl.innerHTML : '';
  const tentarBtn = document.getElementById('acessoTentarDeNovo');
  if(tentarBtn) tentarBtn.addEventListener('click', function(){ tentarBtn.disabled = true; irVerificarAcesso().finally(function(){ tentarBtn.disabled = false; }); });
  function okRecente(uid){
    try{ const o = JSON.parse(localStorage.getItem(IRA_OK_KEY)||'null'); return !!(o && o.uid===uid && Date.now()-o.em < 24*3600*1000); }catch(e){ return false; }
  }
  function marcarOk(uid){ try{ localStorage.setItem(IRA_OK_KEY, JSON.stringify({uid, em:Date.now()})); }catch(e){} }
  const espera = ms=> new Promise(r=>setTimeout(r, ms));
  async function checarPermissao(){
    let ultimo = null;
    for(const atraso of [0, 1500, 3500]){
      if(atraso) await espera(atraso);
      try{
        const r = await comLimite(irSupa.rpc('ldm_pode_acessar', { p_app_key: IRA_APP_KEY }), 12);
        if(!r.error) return {pode: !!r.data};
        ultimo = r.error;
        // Resposta do banco dizendo que não pode/erro de regra: não adianta repetir.
        if(r.error.code && !/^(PGRST301|08|57)/.test(String(r.error.code))) break;
      }catch(e){ ultimo = e; }
    }
    return {erro: ultimo};
  }
  function mostrarNegado(texto, falhaConexao){
    telaLogin.hidden = true; telaNegado.hidden = false;
    if(texto) textoNegadoEl.textContent = texto; else textoNegadoEl.innerHTML = textoNegadoOriginal;
    if(tentarBtn) tentarBtn.hidden = !falhaConexao;
    telaAcesso.classList.remove('escondida');
  }

  async function irVerificarAcesso(){
    let session = null;
    try{ session = (await comLimite(irSupa.auth.getSession(), 10)).data.session; }
    catch(e){
      if(appIniciado) return;
      mostrarNegado('Não consegui falar com o servidor de acesso agora. ' + irAcessoEmPortugues(e && e.message), true);
      return;
    }
    if(!session){
      telaLogin.hidden = false; telaNegado.hidden = true;
      telaAcesso.classList.remove('escondida');
      return;
    }
    /* Enquanto a permissão é conferida na internet, os dados locais já vão sendo
       lidos (sem mostrar nada: a tela de acesso continua por cima). */
    if(!appIniciado && typeof irPreCarregar === 'function') irPreCarregar();
    const r = await checarPermissao();
    if(r.erro){
      if(appIniciado) return;   /* checagem periódica sem conexão: não derruba quem já está usando */
      if(okRecente(session.user.id)){ telaAcesso.classList.add('escondida'); iniciarApp(); return; }
      mostrarNegado('Não consegui confirmar seu acesso agora (falha de conexão). Seu login continua salvo — clique em "Tentar de novo".', true);
      return;
    }
    if(!r.pode){
      try{ localStorage.removeItem(IRA_OK_KEY); }catch(e){}
      mostrarNegado(null, false);
      const emailEl = document.getElementById('acessoNegadoEmail'); if(emailEl) emailEl.textContent = session.user.email;
      return;
    }
    marcarOk(session.user.id);
    telaAcesso.classList.add('escondida');
    iniciarApp();
  }

  /* Fora do callback (setTimeout): chamar o Supabase de dentro do aviso de
     login trava a conexão — documentado na biblioteca. */
  /* Retirou o acesso de alguém? A permissão é conferida de novo a cada minuto (e ao voltar para a aba): a tela de
     bloqueio volta sozinha, sem a pessoa precisar sair e entrar. */
  setInterval(function(){ if(appIniciado && !document.hidden) irVerificarAcesso(); }, 60000);
  document.addEventListener('visibilitychange', function(){ if(appIniciado && !document.hidden) irVerificarAcesso(); });

  irSupa.auth.onAuthStateChange(function(){ setTimeout(irVerificarAcesso, 0); });
  irVerificarAcesso();
})();
