/* ============================================================
   RG Reversa — trava de acesso real.
   Mesmo projeto Supabase de Tarefas/Projetos ("Estoque Project"), schema
   "acessos" (ver supabase-acessos/ na raiz do repositório). Só entra quem
   o administrador cadastrou em Configurações (hub) com permissão pra este
   app — o bloqueio é checado pelo banco (RLS), não só aqui no navegador.
   ============================================================ */
const RG_APP_KEY = 'rgreversa';
const RG_SUPA_URL = 'https://jfvnswafpeshyfweoadg.supabase.co';
const RG_SUPA_ANON = 'sb_publishable_x1ioDmPDsDZdTgcq6SOCGw_PlJeIw_m';

window.rgSupa = window.supabase.createClient(RG_SUPA_URL, RG_SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function rgAcessoEmPortugues(msg){
  const m = String(msg || '').toLowerCase();
  if(m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if(m.includes('email not confirmed')) return 'Confirme o e-mail pelo link que o Supabase enviou e tente de novo.';
  if(m.includes('user already registered')) return 'Este e-mail já tem acesso criado. Use "Já tenho acesso".';
  if(m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if(m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Espere alguns minutos.';
  return msg || 'Não consegui completar a operação.';
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
        const { error } = await rgSupa.auth.signInWithPassword({ email: email, password: senha });
        if(error) throw error;
      } else if(modo === 'criar'){
        const { error } = await rgSupa.auth.signUp({ email: email, password: senha });
        if(error) throw error;
        recadoEl.textContent = 'Acesso criado. Se o e-mail já estiver liberado pro administrador, você já entra; senão, peça pra ele te cadastrar em Configurações.';
        recadoEl.hidden = false;
      } else {
        const { error } = await rgSupa.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
        if(error) throw error;
        recadoEl.textContent = 'Se este e-mail tiver acesso, o link de troca de senha chega em instantes.';
        recadoEl.hidden = false;
      }
      await rgVerificarAcesso();
    } catch(falha){
      erroEl.textContent = rgAcessoEmPortugues(falha && falha.message);
      erroEl.hidden = false;
    } finally {
      enviarBtn.disabled = false;
    }
  });

  sairNegadoBtn.addEventListener('click', function(){ rgSupa.auth.signOut().then(rgVerificarAcesso); });
  if(sairSidebarBtn) sairSidebarBtn.addEventListener('click', function(){ rgSupa.auth.signOut().then(rgVerificarAcesso); });

  /* Abre o app (uma vez só). */
  function iniciarApp(){
    if(appIniciado) return;
      appIniciado = true;
      /* Registra a visita pra contar na frequência (Configurações do hub).
         Não bloqueia o app por causa disso — se falhar, só não conta. */
      rgSupa.rpc('ldm_registrar_acesso', { p_app_key: RG_APP_KEY }).then(function(){}, function(){});
      window.rgIniciar();
  }

  async function rgVerificarAcesso(){
    const { data: { session } } = await rgSupa.auth.getSession();
    if(!session){
      try { Object.keys(localStorage).forEach(function(k){ if(k.indexOf('ldm-acesso-') === 0) localStorage.removeItem(k); }); } catch(e){}
      telaLogin.hidden = false; telaNegado.hidden = true;
      telaAcesso.classList.remove('escondida');
      return;
    }
    /* Caminho rápido: se esta pessoa já foi liberada neste aparelho nas últimas 12 h, abre o app agora e confirma
       a permissão em segundo plano (o banco continua barrando os dados de quem não tiver acesso). */
    const CACHE_ACESSO = 'ldm-acesso-' + RG_APP_KEY;
    let rapido = false;
    try { const c = JSON.parse(localStorage.getItem(CACHE_ACESSO) || 'null'); rapido = !!(c && c.u === session.user.id && Date.now() - c.t < 12 * 3600 * 1000); } catch(e){}
    if(rapido){ telaAcesso.classList.add('escondida'); iniciarApp(); }
    const { data: pode, error } = await rgSupa.rpc('ldm_pode_acessar', { p_app_key: RG_APP_KEY });
    if(error){
      if(rapido) return;   /* sem conexão: segue aberto com o que já foi liberado */
      telaLogin.hidden = true; telaNegado.hidden = false;
      document.getElementById('acessoNegadoTexto').textContent = 'Não consegui checar a permissão: ' + error.message;
      telaAcesso.classList.remove('escondida');
      return;
    }
    if(!pode){
      try { localStorage.removeItem(CACHE_ACESSO); } catch(e){}
      telaLogin.hidden = true; telaNegado.hidden = false;
      negadoEmailEl.textContent = session.user.email;
      telaAcesso.classList.remove('escondida');
      return;
    }
    telaAcesso.classList.add('escondida');
    try { localStorage.setItem(CACHE_ACESSO, JSON.stringify({ u: session.user.id, t: Date.now() })); } catch(e){}
    iniciarApp();
  }

  rgSupa.auth.onAuthStateChange(function(){ rgVerificarAcesso(); });
  rgVerificarAcesso();
})();
