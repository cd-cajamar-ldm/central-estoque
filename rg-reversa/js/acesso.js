/* ============================================================
   RG Reversa — trava de acesso real.
   Mesmo projeto Supabase de Tarefas/Projetos ("Estoque Project"), schema
   "acessos" (ver supabase-acessos/ na raiz do repositório). Só entra quem
   o administrador cadastrou em Configurações (hub) com permissão pra este
   app — o bloqueio é checado pelo banco (RLS), não só aqui no navegador.
   ============================================================ */
/* Link do e-mail de "Esqueci a senha": o Supabase abre a página com #...type=recovery. Guarda antes de ele limpar o endereço. */
let rgEmRecuperacao = /[#&]type=recovery(&|$)/.test(window.location.hash);
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
  if(m.includes('different from the old password')) return 'A nova senha precisa ser diferente da anterior.';
  if(m.includes('session missing') || m.includes('expired')) return 'O link expirou. Peça um novo em "Esqueci a senha".';
  if(m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Espere alguns minutos.';
  return msg || 'Não consegui completar a operação.';
}

/* "E-mail ou senha incorretos" vale tanto para senha errada quanto para quem o administrador liberou mas ainda não
   criou a senha (Primeiro acesso) ou nem foi liberado. Depois de um login que falhou, pergunta ao banco qual é o caso
   para trocar a mensagem genérica por uma explicação certa (mesma função dos outros apps: ldm_situacao_email). */
async function rgDicaDeEmail(email){
  try {
    const { data, error } = await rgSupa.rpc('ldm_situacao_email', { p_email: email });
    if(error || !data) return null;
    if(data === 'sem_conta') return 'Este e-mail já foi liberado pelo administrador, mas ainda não tem senha criada. Clique em "Primeiro acesso" e crie sua senha.';
    if(data === 'nao_cadastrado'){
      /* Mostra exatamente o que foi procurado: quase sempre é letra trocada (ex.: "macanico" em vez de "mecanico"). */
      const DOMINIO = '@lojadomecanico.com.br';
      const certo = email.slice(-DOMINIO.length) === DOMINIO;
      return 'O e-mail "' + email + '" não está na lista de liberados. ' +
        (certo ? 'Confira se não há letra trocada ou faltando. ' : 'O e-mail da empresa termina em ' + DOMINIO + ' — confira o que foi digitado. ') +
        'Se estiver certo, peça pro administrador cadastrar em Configurações, no painel da Central.';
    }
    if(data === 'tem_conta') return 'Este e-mail já tem senha, e ela não confere. Se usa outro app da Central (Inventário, Tarefas...), é a mesma senha. Se esqueceu, clique em "Esqueci a senha".';
    return null;
  } catch(e){ return null; }
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

  /* Cartão "Criar nova senha": aparece quando a pessoa chega pelo link do e-mail de "Esqueci a senha". */
  const telaNova = document.createElement('div');
  telaNova.className = 'acesso-cartao'; telaNova.id = 'acessoNovaSenha'; telaNova.hidden = true;
  telaNova.innerHTML = '<h1>Criar nova senha</h1><p class="acesso-sub">Escolha a senha que você vai usar para entrar no RG Reversa e no coletor.</p>' +
    '<form id="acessoNovaForm">' +
    '<label class="acesso-campo"><span class="acesso-rotulo">Nova senha</span><input type="password" id="acessoNova1" class="acesso-input" required minlength="6" autocomplete="new-password" placeholder="pelo menos 6 caracteres"></label>' +
    '<label class="acesso-campo"><span class="acesso-rotulo">Repita a senha</span><input type="password" id="acessoNova2" class="acesso-input" required minlength="6" autocomplete="new-password"></label>' +
    '<p class="acesso-erro" id="acessoNovaErro" hidden></p>' +
    '<button type="submit" class="acesso-botao" id="acessoNovaEnviar">Salvar senha</button></form>';
  telaLogin.parentNode.insertBefore(telaNova, telaLogin.nextSibling);
  function mostrarNovaSenha(){
    telaLogin.hidden = true; telaNegado.hidden = true; telaNova.hidden = false;
    telaAcesso.classList.remove('escondida');
  }
  telaNova.querySelector('form').addEventListener('submit', async function(e){
    e.preventDefault();
    const erro = document.getElementById('acessoNovaErro'), btn = document.getElementById('acessoNovaEnviar');
    const a = document.getElementById('acessoNova1').value, b = document.getElementById('acessoNova2').value;
    erro.hidden = true;
    if(a !== b){ erro.textContent = 'As duas senhas precisam ser iguais.'; erro.hidden = false; return; }
    btn.disabled = true;
    try {
      const { error } = await rgSupa.auth.updateUser({ password: a });
      if(error) throw error;
      rgEmRecuperacao = false;
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(x){}
      telaNova.hidden = true; telaLogin.hidden = false;
      await rgVerificarAcesso();
    } catch(falha){
      erro.textContent = rgAcessoEmPortugues(falha && falha.message); erro.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

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
        const { error } = await rgSupa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
        if(error) throw error;
        recadoEl.textContent = 'Se este e-mail tiver acesso, o link de troca de senha chega em instantes.';
        recadoEl.hidden = false;
      }
      await rgVerificarAcesso();
    } catch(falha){
      var mensagem = rgAcessoEmPortugues(falha && falha.message);
      if(modo === 'entrar' && String(falha && falha.message || '').toLowerCase().includes('invalid login credentials')){
        var dica = await rgDicaDeEmail(email);
        if(dica) mensagem = dica;
      }
      erroEl.textContent = mensagem;
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
      /* Nível de acesso: 'visualizar' = consulta + coletor, sem importar nem apagar dados (o banco também recusa).
         Se a consulta falhar ou demorar, segue como editor — quem decide de verdade é o banco. */
      rgSupa.rpc('ldm_nivel_acesso', { p_app_key: RG_APP_KEY }).then(function(r){
        if(r && r.data === 'visualizar'){
          window.LDM_SOMENTE_LEITURA = true;
          document.documentElement.classList.add('somente-leitura');
          if(window.rgAplicaNivel) window.rgAplicaNivel();
        }
      }, function(){});
  }

  async function rgVerificarAcesso(){
    const { data: { session } } = await rgSupa.auth.getSession();
    if(!session){
      telaLogin.hidden = false; telaNegado.hidden = true;
      telaAcesso.classList.remove('escondida');
      return;
    }
    if(rgEmRecuperacao){ mostrarNovaSenha(); return; }
    const { data: pode, error } = await rgSupa.rpc('ldm_pode_acessar', { p_app_key: RG_APP_KEY });
    if(error){
      if(appIniciado) return;   /* checagem periódica sem conexão: não derruba quem já está usando */
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
    iniciarApp();
  }

  /* Retirou o acesso de alguém? A permissão é conferida de novo a cada minuto (e ao voltar para a aba): a tela de
     bloqueio volta sozinha, sem a pessoa precisar sair e entrar. */
  setInterval(function(){ if(appIniciado && !document.hidden) rgVerificarAcesso(); }, 60000);
  document.addEventListener('visibilitychange', function(){ if(appIniciado && !document.hidden) rgVerificarAcesso(); });

  rgSupa.auth.onAuthStateChange(function(evento){ if(evento === 'PASSWORD_RECOVERY') rgEmRecuperacao = true; rgVerificarAcesso(); });
  rgVerificarAcesso();
})();
