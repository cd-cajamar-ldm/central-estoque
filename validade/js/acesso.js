/* ============================================================
   Controle de Validade — trava de acesso real.
   Mesmo projeto Supabase de Tarefas/Projetos ("Estoque Project"), schema
   "acessos" (ver supabase-acessos/ na raiz do repositório). Só entra quem
   o administrador cadastrou em Configurações (hub) com permissão pra este
   app — o bloqueio é checado pelo banco (RLS), não só aqui no navegador.
   ============================================================ */
const VL_APP_KEY = 'validade';
const VL_SUPA_URL = 'https://jfvnswafpeshyfweoadg.supabase.co';
const VL_SUPA_ANON = 'sb_publishable_x1ioDmPDsDZdTgcq6SOCGw_PlJeIw_m';

const vlSupa = window.supabase.createClient(VL_SUPA_URL, VL_SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function vlAcessoEmPortugues(msg){
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
        const { error } = await vlSupa.auth.signInWithPassword({ email: email, password: senha });
        if(error) throw error;
      } else if(modo === 'criar'){
        const { error } = await vlSupa.auth.signUp({ email: email, password: senha });
        if(error) throw error;
        recadoEl.textContent = 'Acesso criado. Se o e-mail já estiver liberado pro administrador, você já entra; senão, peça pra ele te cadastrar em Configurações.';
        recadoEl.hidden = false;
      } else {
        const { error } = await vlSupa.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
        if(error) throw error;
        recadoEl.textContent = 'Se este e-mail tiver acesso, o link de troca de senha chega em instantes.';
        recadoEl.hidden = false;
      }
      await vlVerificarAcesso();
    } catch(falha){
      erroEl.textContent = vlAcessoEmPortugues(falha && falha.message);
      erroEl.hidden = false;
    } finally {
      enviarBtn.disabled = false;
    }
  });

  sairNegadoBtn.addEventListener('click', function(){ vlSupa.auth.signOut().then(vlVerificarAcesso); });
  if(sairSidebarBtn) sairSidebarBtn.addEventListener('click', function(){ vlSupa.auth.signOut().then(vlVerificarAcesso); });

  async function vlVerificarAcesso(){
    const { data: { session } } = await vlSupa.auth.getSession();
    if(!session){
      telaLogin.hidden = false; telaNegado.hidden = true;
      telaAcesso.classList.remove('escondida');
      return;
    }
    const { data: pode, error } = await vlSupa.rpc('ldm_pode_acessar', { p_app_key: VL_APP_KEY });
    if(error){
      telaLogin.hidden = true; telaNegado.hidden = false;
      document.getElementById('acessoNegadoTexto').textContent = 'Não consegui checar a permissão: ' + error.message;
      telaAcesso.classList.remove('escondida');
      return;
    }
    if(!pode){
      telaLogin.hidden = true; telaNegado.hidden = false;
      negadoEmailEl.textContent = session.user.email;
      telaAcesso.classList.remove('escondida');
      return;
    }
    telaAcesso.classList.add('escondida');
    if(!appIniciado){
      appIniciado = true;
      /* O app abre JÁ, sem esperar o banco. Esperar a consulta do nível antes
         de vlInit() deixava a tela presa em "Carregando..." quando a chamada
         não voltava (ex.: disparada de dentro do aviso de login do Supabase,
         que segura a conexão até o aviso terminar). */
      vlInit();
      /* Nível de acesso: 'visualizar' esconde importação/configuração e não
         grava na nuvem (o banco também recusa). Se a consulta falhar ou
         demorar, segue como editor — quem decide de verdade é o banco. */
      vlSupa.rpc('ldm_nivel_acesso', { p_app_key: VL_APP_KEY }).then(function(r){
        if(r && r.data === 'visualizar'){
          window.LDM_SOMENTE_LEITURA = true;
          document.documentElement.classList.add('somente-leitura');
          if(window.vlAplicarNivel) window.vlAplicarNivel();
        }
      }).catch(function(){});
      /* Registra a visita pra contar na frequência (Configurações do hub).
         Não bloqueia o app por causa disso — se falhar, só não conta. */
      vlSupa.rpc('ldm_registrar_acesso', { p_app_key: VL_APP_KEY }).catch(function(){});
    }
  }

  /* Fora do callback (setTimeout): chamar o Supabase de dentro do aviso de
     login trava a conexão — documentado na biblioteca. */
  vlSupa.auth.onAuthStateChange(function(){ setTimeout(vlVerificarAcesso, 0); });
  vlVerificarAcesso();
})();
