/* Fumaca no navegador: sobe o build publicado e confere que a tela de
   acesso aparece sem erro de JavaScript. Nao valida login - o Supabase
   exige rede externa -, so garante que o bundle nao quebrou.
   Uso: node scripts/verificarTela.mjs [url] */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:8099/';
/* O Chromium ja vem instalado no ambiente; PW_CHROMIUM aponta para
   ele quando a versao empacotada com o Playwright nao esta baixada. */
const executablePath = process.env.PW_CHROMIUM;
const navegador = await chromium.launch(executablePath ? { executablePath } : {});
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });

const erros = [];
pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(1500);

const texto = (await pagina.textContent('body')) ?? '';
/* Falha de rede ao Supabase e esperada fora da empresa; o que nao pode
   existir e erro de codigo. */
const relevantes = erros.filter((e) => !/supabase|Failed to fetch|net::|Load failed/i.test(e));

if (!texto.includes('Tarefas')) {
  console.error('FALHOU: a tela nao renderizou.');
  process.exitCode = 1;
} else if (relevantes.length) {
  console.error('FALHOU: erros de JavaScript', relevantes);
  process.exitCode = 1;
} else {
  console.log('OK: tela de acesso renderizada sem erros de JavaScript.');
}

await pagina.screenshot({ path: 'verificacao-tela.png', fullPage: true });
await navegador.close();
