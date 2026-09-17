/* Fumaca das telas internas com a API simulada.
   O Supabase nao esta acessivel em toda maquina (rede da empresa,
   ambiente de CI), e mesmo acessivel o banco de producao nao serve para
   teste. Aqui as respostas do PostgREST sao interceptadas e devolvidas
   com dados fixos, o que exercita painel, carteira, cronograma e
   detalhe de projeto de verdade.
   Uso: node scripts/verificarTelas.mjs [url] */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/* A biblioteca de planilha e CommonJS: aqui ela so serve para reabrir o
   arquivo baixado e conferir que veio com conteudo. */
const XLSX = createRequire(import.meta.url)('xlsx-js-style');

const url = process.argv[2] ?? 'http://127.0.0.1:8099/';
const hoje = new Date();
const iso = (deslocamentoEmDias) => {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + deslocamentoEmDias);
  return d.toISOString().slice(0, 10);
};

const USUARIO = { id: 'u1', email: 'danilo@exemplo.com' };

const pessoas = [
  { id: 'p1', user_id: USUARIO.id, nome: 'Danilo Lima', email: 'danilo@exemplo.com', area: 'Estoque', papel: 'admin', ativo: true },
  { id: 'p2', user_id: null, nome: 'Equipe Recebimento', email: 'recebimento@exemplo.com', area: 'Recebimento', papel: 'editor', ativo: true },
];

const projetos = [
  {
    id: 'j1', codigo: 'PRJ-001', nome: 'Reendereçamento do mezanino', descricao: 'Revisão de endereços e capacidade.',
    projeto_pai_id: null, rotulo_filhos: null, area: 'Estoque', responsavel_id: 'p1', status: 'em_andamento', prioridade: 'alta',
    inicio_previsto: iso(-40), fim_previsto: iso(20), inicio_real: iso(-38), fim_real: null,
    percentual: 45, criado_por: null, criado_em: '', atualizado_em: '',
    chamado: '145537', chamado_url: 'https://exemplo/requests/145537', ticket_jira: 'BM-1438',
  },
  {
    id: 'j2', codigo: 'PRJ-002', nome: 'Automação da conferência cega', descricao: null,
    projeto_pai_id: null, rotulo_filhos: null, area: 'Recebimento', responsavel_id: 'p2', status: 'em_risco', prioridade: 'critica',
    inicio_previsto: iso(-70), fim_previsto: iso(-8), inicio_real: iso(-70), fim_real: null,
    percentual: 60, criado_por: null, criado_em: '', atualizado_em: '',
  },
  {
    id: 'j3', codigo: 'PRJ-003', nome: 'Padronização de paletes', descricao: null,
    projeto_pai_id: null, rotulo_filhos: null, area: 'Expedição', responsavel_id: 'p1', status: 'concluido', prioridade: 'media',
    inicio_previsto: iso(-120), fim_previsto: iso(-25), inicio_real: iso(-118), fim_real: iso(-25),
    percentual: 100, criado_por: null, criado_em: '', atualizado_em: '',
  },
];

projetos.push(
  {
    id: 'g1', codigo: 'PRJ-100', nome: 'Melhoria Sistêmica Bseller', descricao: 'Guarda-chuva das melhorias sistêmicas.',
    projeto_pai_id: null, rotulo_filhos: 'Melhorias', area: 'Sistema', responsavel_id: 'p1', status: 'em_andamento', prioridade: 'alta',
    inicio_previsto: iso(-30), fim_previsto: iso(60), inicio_real: null, fim_real: null,
    percentual: 0, criado_por: null, criado_em: '', atualizado_em: '',
  },
  {
    id: 'g1a', codigo: null, nome: 'Entrada massiva', descricao: null,
    projeto_pai_id: 'g1', rotulo_filhos: null, area: 'Sistema', responsavel_id: 'p1', status: 'em_andamento', prioridade: 'alta',
    inicio_previsto: iso(-10), fim_previsto: iso(20), inicio_real: null, fim_real: null,
    percentual: 30, criado_por: null, criado_em: '', atualizado_em: '',
  },
  {
    id: 'g1b', codigo: null, nome: 'Trava sistêmica para paletes', descricao: null,
    projeto_pai_id: 'g1', rotulo_filhos: null, area: 'Sistema', responsavel_id: 'p2', status: 'nao_iniciado', prioridade: 'media',
    inicio_previsto: null, fim_previsto: null, inicio_real: null, fim_real: null,
    percentual: 0, criado_por: null, criado_em: '', atualizado_em: '',
  },
);

const marcos = [
  { id: 'm1', projeto_id: 'j1', nome: 'Levantamento de endereços', descricao: null, data_prevista: iso(-20), data_real: iso(-19), concluido: true, ordem: 0 },
  { id: 'm2', projeto_id: 'j1', nome: 'Migração dos itens', descricao: null, data_prevista: iso(10), data_real: null, concluido: false, ordem: 1 },
  { id: 'm3', projeto_id: 'j2', nome: 'Piloto em uma doca', descricao: null, data_prevista: iso(-15), data_real: null, concluido: false, ordem: 0 },
];

const tarefas = [
  { id: 't1', projeto_id: 'j1', marco_id: 'm1', titulo: 'Exportar base de endereços', descricao: null, responsavel_id: 'p1', status: 'concluida', inicio: iso(-30), prazo: iso(-22), concluida_em: iso(-23), ordem: 0 },
  { id: 't2', projeto_id: 'j1', marco_id: 'm2', titulo: 'Reetiquetar corredor C', descricao: null, responsavel_id: 'p2', status: 'em_andamento', inicio: iso(-5), prazo: iso(8), concluida_em: null, ordem: 1 },
];

const atualizacoes = [
  {
    id: 'a1', projeto_id: 'j1', data: iso(-3), texto: 'Corredores A e B concluídos; C começa na semana que vem.',
    status_reportado: 'em_andamento', percentual: 45, riscos: 'Falta de etiquetas pode travar o corredor C.',
    proximos_passos: 'Abrir pedido de etiquetas.', autor_id: null, autor_nome: 'Danilo Lima', criado_em: '',
  },
];

const anexos = [
  {
    id: 'x1', projeto_id: 'j1', marco_id: null, atualizacao_id: null,
    caminho: 'j1/antes.jpg', nome_arquivo: 'antes.jpg', tipo_mime: 'image/jpeg',
    tamanho_bytes: 240000, momento: 'antes', legenda: 'Corredor C antes da revisão',
    par: 'Corredor C', enviado_por: 'Danilo Lima', criado_em: iso(-10),
  },
  {
    id: 'x2', projeto_id: 'j1', marco_id: null, atualizacao_id: null,
    caminho: 'j1/depois.jpg', nome_arquivo: 'depois.jpg', tipo_mime: 'image/jpeg',
    tamanho_bytes: 220000, momento: 'depois', legenda: 'Corredor C reetiquetado',
    par: 'Corredor C', enviado_por: 'Danilo Lima', criado_em: iso(-1),
  },
  {
    id: 'x3', projeto_id: 'j1', marco_id: null, atualizacao_id: 'a1',
    caminho: 'j1/evidencia.jpg', nome_arquivo: 'evidencia.jpg', tipo_mime: 'image/jpeg',
    tamanho_bytes: 180000, momento: 'evidencia', legenda: null, par: null,
    enviado_por: 'Danilo Lima', criado_em: iso(-3),
  },
  {
    id: 'x4', projeto_id: 'j1', marco_id: null, atualizacao_id: null,
    caminho: 'j1/plano.pdf', nome_arquivo: 'plano-de-endereços.pdf', tipo_mime: 'application/pdf',
    tamanho_bytes: 1240000, momento: 'documento', legenda: null, par: null,
    enviado_por: 'Equipe Recebimento', criado_em: iso(-30),
  },
];

const paginas = [
  {
    id: 'g1', projeto_id: 'j1', titulo: 'Comportamento da tela de endereço', ordem: 0, status: 'aprovada',
    atualizado_por: 'Danilo Lima', criado_em: iso(-8), atualizado_em: iso(-2),
    blocos: [
      {
        id: 'b1', tipo: 'texto',
        conteudo: '<h2>Busca de endereço</h2><p>Ao digitar o código, a tela deve destacar o corredor em <strong>laranja</strong> e mostrar a capacidade restante.</p><img src="https://exemplo/print.png" alt="print da tela">',
      },
      {
        id: 'b2', tipo: 'fluxo',
        conteudo: JSON.stringify({
          nos: [
            { id: 'n1', texto: 'Digita o código', x: 40, y: 40, largura: 180, altura: 64, forma: 'caixa', cor: '#7C3AED' },
            { id: 'n2', texto: 'Endereço existe?', x: 320, y: 30, largura: 170, altura: 96, forma: 'decisao', cor: '#2F6FE0' },
          ],
          ligacoes: [{ id: 'l1', de: 'n1', para: 'n2', rotulo: 'Sim' }],
        }),
      },
    ],
  },
];

/* Sem documentos gerados: o que o teste confere aqui e o estado vazio
   da secao, que e o primeiro que qualquer pessoa vai ver. */
const documentos = [];

const configuracoes = [];
const porTabela = { pessoas, projetos, marcos, tarefas, atualizacoes, anexos, paginas, documentos, configuracoes };

/* Imagem de 1x1 no lugar do arquivo real: o teste confere o layout da
   galeria, nao o conteudo da foto. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const navegador = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const pagina = await navegador.newPage({ viewport: { width: Number(process.env.LARGURA ?? 1360), height: 1000 } });

/* O modulo agora exige login. O teste entra com uma sessao ja pronta no
   armazenamento do navegador e responde as rotas de autenticacao: o que
   se quer verificar aqui sao as telas, nao o Supabase Auth. */
const SESSAO = {
  access_token: 'teste', refresh_token: 'teste', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: USUARIO.id, aud: 'authenticated', role: 'authenticated', email: USUARIO.email,
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  },
};
await pagina.addInitScript(([chave, sessao]) => {
  localStorage.setItem(chave, JSON.stringify(sessao));
}, ['sb-jfvnswafpeshyfweoadg-auth-token', SESSAO]);

await pagina.route('**/auth/v1/**', async (rota) => {
  const url = rota.request().url();
  const corpo = url.includes('/user') ? SESSAO.user : SESSAO;
  await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
});

const erros = [];
/* Falha ao baixar recurso externo (a fonte do Google, por exemplo) nao
   e defeito do modulo: em maquina sem saida para a internet isso e
   esperado, e o app tem pilha de fontes alternativa. */
const ruido = (t) => /Failed to load resource|net::|ERR_/i.test(t);
pagina.on('console', (m) => { if (m.type() === 'error' && !ruido(m.text())) erros.push(m.text()); });
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));

await pagina.route('**/rest/v1/**', async (rota) => {
  const caminho = new URL(rota.request().url()).pathname.split('/').pop() ?? '';
  const linhas = porTabela[caminho] ?? [];
  /* Configuracao: a simulacao guarda o que o app grava e devolve na
     releitura, filtrando por chave. Sem o filtro, a leitura de uma
     chave so traria a tabela inteira e a tela reclamaria de ter achado
     mais de uma linha. */
  if (caminho === 'configuracoes') {
    const metodo = rota.request().method();
    const chave = (new URL(rota.request().url()).searchParams.get('chave') ?? '').replace('eq.', '');
    if (metodo === 'DELETE') {
      const i = configuracoes.findIndex((c) => c.chave === chave);
      if (i >= 0) configuracoes.splice(i, 1);
      await rota.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (metodo !== 'GET') {
      const corpo = JSON.parse(rota.request().postData() ?? '[]');
      for (const linha of [].concat(corpo)) {
        const i = configuracoes.findIndex((c) => c.chave === linha.chave);
        if (i < 0) configuracoes.push(linha); else configuracoes[i] = linha;
      }
      await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(configuracoes) });
      return;
    }
    const achadas = chave ? configuracoes.filter((c) => c.chave === chave) : configuracoes;
    await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(achadas) });
    return;
  }
  const parametros = new URL(rota.request().url()).searchParams;
  /* A tela pergunta pelo cadastro do proprio usuario logado antes de
     qualquer outra coisa; sem esta resposta ela para no aviso de acesso
     nao liberado. */
  if (parametros.get('user_id')) {
    await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pessoas[0]) });
    return;
  }
  const filtro = parametros.get('projeto_id');
  /* O app pergunta tanto por um projeto (eq.) quanto pelo conjunto de
     atividades de uma vez (in.(a,b)) — a simulacao precisa entender os
     dois, senao a contagem de conteudo volta vazia. */
  const emLista = filtro?.startsWith('in.')
    ? filtro.slice(4, -1).split(',').map((i) => i.replaceAll('"', ''))
    : null;
  const corpo = !filtro
    ? linhas
    : emLista
      ? linhas.filter((l) => emLista.includes(l.projeto_id))
      : linhas.filter((l) => l.projeto_id === filtro.replace('eq.', ''));
  await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
});

await pagina.route('**/storage/v1/object/public/**', async (rota) => {
  await rota.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
});

/* O print do bloco de texto: o compartilhar tem de baixá-lo e embutir no
   arquivo, em vez de deixar a imagem apontando para fora. */
await pagina.route('https://exemplo/**', async (rota) => {
  await rota.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
});

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(1200);

/* Primeira visita: o guia abre sozinho e tem de sair inteiro num clique
   — ele fica na frente de tudo, entao um guia que nao fecha travaria o
   modulo para quem chega. */
const comGuia = (await pagina.textContent('body')) ?? '';
if (!comGuia.includes('Bem-vindo ao módulo Projetos')) {
  console.error('FALHOU: o guia não abriu na primeira visita.');
  process.exitCode = 1;
}
if (/BSeller|Bseller/.test(comGuia)) {
  console.error('FALHOU: a abertura do guia não deve tratar um sistema específico como o assunto do módulo.');
  process.exitCode = 1;
}
/* A visita aponta para a tela: cada passo com alvo tem de destacar o
   elemento de verdade, e nao so trocar o texto do cartao. */
await pagina.getByRole('button', { name: 'Próximo', exact: true }).click();
await pagina.waitForTimeout(500);
const destaque = pagina.locator('.ring-roxo').first();
if (!(await destaque.count())) {
  console.error('FALHOU: o guia não destacou o elemento apontado pelo passo.');
  process.exitCode = 1;
} else {
  const alvo = await pagina.locator('[data-guia="abas"]').boundingBox();
  const marca = await destaque.boundingBox();
  if (!alvo || !marca || Math.abs(alvo.y - marca.y) > 20 || Math.abs(alvo.x - marca.x) > 20) {
    console.error('FALHOU: o destaque do guia não caiu sobre as abas.');
    process.exitCode = 1;
  }
}
await pagina.screenshot({ path: 'verificacao-guia.png', fullPage: true });

/* A visita abre as telas de que fala. O passo da lista de projetos leva
   para a aba Projetos, e o das paginas abre uma atividade de verdade:
   guia que so troca o texto e continua parado nao ensina nada. */
/* Ja se andou um passo na checagem do destaque; faltam dois ate a
   carteira. */
for (let i = 0; i < 2; i += 1) {
  await pagina.getByRole('button', { name: 'Próximo', exact: true }).click();
  await pagina.waitForTimeout(500);
}
if (!/#\/projetos/.test(pagina.url())) {
  console.error(`FALHOU: o passo da carteira não abriu a aba Projetos — "${pagina.url()}".`);
  process.exitCode = 1;
}
await pagina.getByRole('button', { name: 'Próximo', exact: true }).click();
await pagina.waitForTimeout(900);
if (!/#\/projeto\//.test(pagina.url())) {
  console.error(`FALHOU: o passo das atividades não abriu um projeto — "${pagina.url()}".`);
  process.exitCode = 1;
}
await pagina.screenshot({ path: 'verificacao-guia-projeto.png', fullPage: true });
await pagina.getByRole('button', { name: 'Pular tudo', exact: true }).click();
await pagina.waitForTimeout(300);
if (((await pagina.textContent('body')) ?? '').includes('Pular tudo')) {
  console.error('FALHOU: "Pular tudo" não fechou o guia.');
  process.exitCode = 1;
}
if (/#\/projeto\//.test(pagina.url())) {
  console.error(`FALHOU: ao fechar, o guia deveria devolver a tela em que a pessoa estava — "${pagina.url()}".`);
  process.exitCode = 1;
}

const telas = [
  ['painel', 'Painel'],
  ['projetos', 'Projetos'],
  ['cronograma', 'Cronograma'],
  ['pessoas', 'Pessoas'],
];

for (const [arquivo, aba] of telas) {
  await pagina.getByRole('button', { name: aba, exact: true }).click();
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: `verificacao-${arquivo}.png`, fullPage: true });
}

/* No painel a faixa cobre a carteira inteira, e ali ha projeto com
   chamado: os quatro cartoes aparecem. */
await pagina.getByRole('button', { name: 'Painel', exact: true }).click();
await pagina.waitForTimeout(600);
const faixaDoPainel = (await pagina.textContent('body')) ?? '';
for (const rotulo of ['Documentadas', 'Com chamado aberto', 'Prontas para abrir chamado', 'Concluídas']) {
  if (!faixaDoPainel.includes(rotulo)) {
    console.error(`FALHOU: o painel não trouxe o cartão "${rotulo}".`);
    process.exitCode = 1;
  }
}

// Detalhe: abre pela linha da carteira.
await pagina.getByRole('button', { name: 'Projetos', exact: true }).click();
await pagina.getByText('Reendereçamento do mezanino').first().click();
await pagina.waitForTimeout(700);
await pagina.screenshot({ path: 'verificacao-detalhe.png', fullPage: true });

/* Exportar Excel: o arquivo tem de chegar com conteudo. Planilha vazia
   parece defeito do Excel e some com a confianca no relatorio. */
const [baixado] = await Promise.all([
  pagina.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  pagina.getByRole('button', { name: 'Exportar Excel', exact: true }).first().click(),
]);
if (!baixado) {
  console.error('FALHOU: clicar em Exportar Excel não baixou arquivo nenhum.');
  process.exitCode = 1;
} else {
  const caminho = await baixado.path();
  const livro = XLSX.read(await readFile(caminho));
  const abas = livro.SheetNames;
  const linhas = abas.flatMap((n) => XLSX.utils.sheet_to_json(livro.Sheets[n], { header: 1 }));
  if (!abas.length || linhas.length < 2) {
    console.error(`FALHOU: a planilha veio vazia — abas ${JSON.stringify(abas)}, ${linhas.length} linha(s).`);
    process.exitCode = 1;
  }
}

/* Print colado no fluxograma: sem botao e sem anexo, so Ctrl+V dentro
   do quadro. O teste cola uma imagem de verdade e confere que ela virou
   bloco do desenho. */
const secaoPaginas = pagina.locator('section').filter({ hasText: '+ Nova página' }).last();
await secaoPaginas.getByRole('button', { name: 'Editar', exact: true }).click();
await pagina.waitForTimeout(400);
const quadroDoFluxo = pagina.locator('[data-quadro="fluxo"]').first();
await quadroDoFluxo.evaluate((alvo, base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const arquivo = new File([bytes], 'print.png', { type: 'image/png' });
  const dados = new DataTransfer();
  dados.items.add(arquivo);
  alvo.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dados, bubbles: true }));
}, PIXEL.toString('base64'));
await pagina.waitForTimeout(900);
const imagemColada = await pagina.locator('img[alt="Print colado no fluxo"]').count();
if (imagemColada < 1) {
  console.error('FALHOU: a imagem colada não virou bloco do fluxograma.');
  process.exitCode = 1;
}
/* Controles de quadro: girar, mudar a cor, esticar pelo canto e mudar o
   estilo da seta. */
await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().click();
await pagina.waitForTimeout(400);
const barra = (await pagina.textContent('body')) ?? '';
for (const controle of ['Seta para outro bloco', 'Excluir bloco']) {
  if (!barra.includes(controle)) {
    console.error(`FALHOU: a barra do fluxograma não tem "${controle}".`);
    process.exitCode = 1;
  }
}
await pagina.getByTitle('Girar 15° à direita').click();
await pagina.waitForTimeout(250);
const girado = await pagina.locator('[data-quadro="fluxo"] div[style*="rotate(15deg)"]').count();
if (!girado) {
  console.error('FALHOU: o bloco não girou.');
  process.exitCode = 1;
}
if (!(await pagina.getByTitle('Arraste para mudar o tamanho').count())) {
  console.error('FALHOU: o bloco selecionado deveria ter alça de tamanho.');
  process.exitCode = 1;
}
/* Zoom: "+" aproxima o desenho de verdade — o bloco na tela fica maior,
   e nao apenas o número na barra. */
const blocoAntes = (await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().boundingBox())?.width ?? 0;
await pagina.getByTitle('Aproximar').click();
await pagina.waitForTimeout(300);
const blocoDepois = (await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().boundingBox())?.width ?? 0;
if (!(blocoDepois > blocoAntes + 1)) {
  console.error(`FALHOU: o zoom não aproximou o desenho (${blocoAntes} → ${blocoDepois}).`);
  process.exitCode = 1;
}
await pagina.getByTitle('Afastar').click();
await pagina.waitForTimeout(300);
const blocoDeVolta = (await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().boundingBox())?.width ?? 0;
if (Math.abs(blocoDeVolta - blocoAntes) > 1) {
  console.error(`FALHOU: afastar não voltou ao tamanho de antes (${blocoAntes} → ${blocoDeVolta}).`);
  process.exitCode = 1;
}

/* Seta recolhida: o campo "Sim / Não" só aparece depois de clicar no
   ponto da seta — antes ele ficava aberto em todas, tapando o desenho. */
if (await pagina.getByPlaceholder('Sim / Não').count()) {
  console.error('FALHOU: o rótulo da seta deveria nascer recolhido.');
  process.exitCode = 1;
}
await pagina.getByTitle('Editar esta seta (rótulo, traço, remover)').first().click();
await pagina.waitForTimeout(300);
if (!(await pagina.getByPlaceholder('Sim / Não').count())) {
  console.error('FALHOU: clicar na seta deveria abrir o rótulo.');
  process.exitCode = 1;
}
if (!(await pagina.getByTitle('Ponta dos dois lados').count())) {
  console.error('FALHOU: a seta deveria oferecer ponta dos dois lados.');
  process.exitCode = 1;
}
await pagina.getByTitle('Recolher').first().click();
await pagina.waitForTimeout(300);
if (await pagina.getByPlaceholder('Sim / Não').count()) {
  console.error('FALHOU: recolher deveria fechar o rótulo da seta.');
  process.exitCode = 1;
}

/* O bloco volta a ser o selecionado depois do passeio pela seta. */
await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().click();
await pagina.waitForTimeout(300);
/* Teclado no quadro: seta move o bloco selecionado e Delete apaga. */
const posicaoAntes = await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().boundingBox();
await pagina.keyboard.press('ArrowRight');
await pagina.waitForTimeout(250);
const posicaoDepois = await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').first().boundingBox();
if (!posicaoAntes || !posicaoDepois || Math.round(posicaoDepois.x - posicaoAntes.x) !== 10) {
  console.error(`FALHOU: a seta do teclado não moveu o bloco 10 px (${posicaoAntes?.x} → ${posicaoDepois?.x}).`);
  process.exitCode = 1;
}
const formas = (await pagina.textContent('body')) ?? '';
for (const forma of ['+ Círculo', '+ Triângulo']) {
  if (!formas.includes(forma)) {
    console.error(`FALHOU: a barra do fluxograma não oferece "${forma}".`);
    process.exitCode = 1;
  }
}
const blocosAntes = await pagina.locator('[data-quadro="fluxo"] > div').count();
await pagina.keyboard.press('Delete');
await pagina.waitForTimeout(300);
if (await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').count()) {
  console.error('FALHOU: o Delete não apagou o bloco selecionado.');
  process.exitCode = 1;
}
if (!(await pagina.locator('[data-quadro="fluxo"] > div').count() < blocosAntes)) {
  console.error('FALHOU: o quadro deveria ter um bloco a menos depois do Delete.');
  process.exitCode = 1;
}

/* Desfazer: o bloco apagado pelo Delete tem de voltar com Ctrl+Z, e sair
   de novo com Ctrl+Y. */
await pagina.keyboard.press('Control+z');
await pagina.waitForTimeout(400);
if (!(await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').count())) {
  console.error('FALHOU: Ctrl+Z não trouxe de volta o bloco apagado.');
  process.exitCode = 1;
}
await pagina.keyboard.press('Control+y');
await pagina.waitForTimeout(400);
if (await pagina.locator('[data-quadro="fluxo"] >> text=Digita o código').count()) {
  console.error('FALHOU: Ctrl+Y não refez a exclusão do bloco.');
  process.exitCode = 1;
}

/* Formas novas: entram no quadro, na cor escolhida na barra, e desenham
   de verdade. */
await pagina.getByTitle('Novas formas em verde').click();
await pagina.getByRole('button', { name: '+ Círculo', exact: true }).click();
await pagina.getByRole('button', { name: '+ Triângulo', exact: true }).click();
await pagina.waitForTimeout(400);

/* Selecao de varios e alinhamento: Shift+clique junta o circulo ao
   triangulo, e alinhar pela esquerda poe os dois na mesma borda. */
/* O texto fica num <span> centralizado dentro do bloco: quem tem posicao
   e o bloco, o pai dele. */
const circulo = pagina.locator('[data-quadro="fluxo"] >> text=Círculo').first().locator('xpath=..');
const triangulo = pagina.locator('[data-quadro="fluxo"] >> text=Triângulo').first().locator('xpath=..');
/* O triângulo acabou de nascer selecionado: as setas o empurram para o
   lado, para os dois blocos entrarem no teste desalinhados. */
for (let i = 0; i < 4; i += 1) await pagina.keyboard.press('ArrowRight');
await pagina.waitForTimeout(300);
await circulo.click();
await triangulo.click({ modifiers: ['Shift'] });
await pagina.waitForTimeout(300);
if (!((await pagina.textContent('body')) ?? '').includes('2 blocos')) {
  console.error('FALHOU: Shift+clique deveria selecionar dois blocos.');
  process.exitCode = 1;
}
const xAntes = [
  (await circulo.boundingBox())?.x ?? 0,
  (await triangulo.boundingBox())?.x ?? 0,
];
if (Math.abs(xAntes[0] - xAntes[1]) < 2) {
  console.error('FALHOU: os dois blocos já nasceram alinhados — o teste não prova nada.');
  process.exitCode = 1;
}
await pagina.getByTitle('Alinhar à esquerda').click();
await pagina.waitForTimeout(300);
const xDepois = [
  (await circulo.boundingBox())?.x ?? 0,
  (await triangulo.boundingBox())?.x ?? 0,
];
if (Math.abs(xDepois[0] - xDepois[1]) > 1) {
  console.error(`FALHOU: alinhar à esquerda não igualou a borda (${xDepois[0]} / ${xDepois[1]}).`);
  process.exitCode = 1;
}
/* Copiar e colar: o par selecionado vira quatro blocos no quadro, e
   recortar tira os originais de lá. */
const blocosDoQuadro = () => pagina.locator('[data-quadro="fluxo"] > div').count();
const antesDaCopia = await blocosDoQuadro();
await pagina.getByTitle('Copiar (Ctrl+C)').click();
await pagina.getByTitle('Colar (Ctrl+V)').click();
await pagina.waitForTimeout(400);
const depoisDaColagem = await blocosDoQuadro();
if (depoisDaColagem !== antesDaCopia + 2) {
  console.error(`FALHOU: colar deveria criar dois blocos (${antesDaCopia} → ${depoisDaColagem}).`);
  process.exitCode = 1;
}
/* O que foi colado nasce selecionado: recortar tira justamente ele. */
await pagina.getByTitle('Recortar (Ctrl+X)').click();
await pagina.waitForTimeout(400);
if ((await blocosDoQuadro()) !== antesDaCopia) {
  console.error('FALHOU: recortar deveria tirar do quadro os blocos selecionados.');
  process.exitCode = 1;
}
await pagina.getByTitle('Colar (Ctrl+V)').click();
await pagina.waitForTimeout(400);
if ((await blocosDoQuadro()) !== antesDaCopia + 2) {
  console.error('FALHOU: o recortado deveria poder ser colado de volta.');
  process.exitCode = 1;
}
await pagina.keyboard.press('Delete');
await pagina.waitForTimeout(300);

/* Um bloco só volta a mostrar a barra de propriedades, não a de alinhar. */
await circulo.click();
await pagina.waitForTimeout(300);
if (((await pagina.textContent('body')) ?? '').includes('2 blocos')) {
  console.error('FALHOU: clique simples deveria recomeçar a seleção num bloco só.');
  process.exitCode = 1;
}
if (!(await pagina.locator('[data-quadro="fluxo"] svg polygon[stroke="#2E8B57"]').count())) {
  console.error('FALHOU: a forma nova não nasceu na cor escolhida na barra.');
  process.exitCode = 1;
}
if (!(await pagina.locator('[data-quadro="fluxo"] svg polygon').count())) {
  console.error('FALHOU: o triângulo não desenhou o contorno.');
  process.exitCode = 1;
}

await pagina.screenshot({ path: 'verificacao-fluxo-imagem.png', fullPage: true });
await secaoPaginas.getByRole('button', { name: 'Cancelar', exact: true }).click();
await pagina.waitForTimeout(300);

/* Compartilhar: a página baixa como um HTML com o texto e o fluxograma
   no mesmo arquivo. */
{
  const baixando = pagina.waitForEvent('download');
  await secaoPaginas.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  const arquivo = await baixando;
  if (!arquivo.suggestedFilename().endsWith('.html')) {
    console.error(`FALHOU: o compartilhar deveria baixar um .html (veio "${arquivo.suggestedFilename()}").`);
    process.exitCode = 1;
  }
  const caminho = await arquivo.path();
  const conteudo = caminho ? await readFile(caminho, 'utf8') : '';
  /* Sem imagem quebrada: o print do texto tem de ir dentro do arquivo. */
  if (/<img[^>]+src="http/i.test(conteudo)) {
    console.error('FALHOU: o arquivo compartilhado ainda depende de imagem na internet.');
    process.exitCode = 1;
  }
  for (const pedaco of ['<!doctype html>', 'Busca de endereço', '<svg', 'data:image/']) {
    if (!conteudo.includes(pedaco)) {
      console.error(`FALHOU: o arquivo compartilhado não tem "${pedaco}".`);
      process.exitCode = 1;
    }
  }
}

/* Campo de lista do documento: o texto passa por lista e volta, e a
   volta apara espacos. Sem cuidado, o espaco some enquanto se digita —
   "Tela no bseller" virava "Telanobseller". */
await pagina.getByRole('button', { name: 'Criar documento', exact: true }).first().click();
await pagina.waitForTimeout(900);
const regras = pagina.getByRole('textbox', { name: /Regras de negócio/i }).first();
await regras.click();
await pagina.keyboard.type('Tela no bseller');
await pagina.waitForTimeout(200);
const digitado = await regras.inputValue();
if (digitado !== 'Tela no bseller') {
  console.error(`FALHOU: o campo de lista comeu o espaço — ficou "${digitado}".`);
  process.exitCode = 1;
}
const botoesDoDocumento = (await pagina.textContent('body')) ?? '';
if (!botoesDoDocumento.includes('Gerar Word e anexar')) {
  console.error('FALHOU: o documento deveria oferecer gerar e anexar num botão só.');
  process.exitCode = 1;
}
await pagina.getByRole('button', { name: 'Fechar', exact: true }).first().click();
await pagina.waitForTimeout(500);

/* Rascunho local: o que foi digitado e nao salvo tem de ser oferecido de
   volta ao reabrir o formulario, em vez de a tela voltar em branco. */
await pagina.getByRole('button', { name: 'Criar documento', exact: true }).first().click();
await pagina.waitForTimeout(900);
const comRascunho = (await pagina.textContent('body')) ?? '';
if (!comRascunho.includes('Há um rascunho não salvo')) {
  console.error('FALHOU: o rascunho digitado não foi oferecido ao reabrir o documento.');
  process.exitCode = 1;
}
await pagina.getByRole('button', { name: 'Recuperar', exact: true }).first().click();
await pagina.waitForTimeout(300);
const recuperado = await pagina.getByRole('textbox', { name: /Regras de negócio/i }).first().inputValue();
if (recuperado !== 'Tela no bseller') {
  console.error(`FALHOU: o rascunho recuperado veio diferente — "${recuperado}".`);
  process.exitCode = 1;
}
await pagina.screenshot({ path: 'verificacao-rascunho.png', fullPage: true });

/* Texto corrido: colar o pedido inteiro e clicar em preencher tem de
   distribuir os blocos pelas secoes, sem JSON no meio do caminho. */
const pedido = [
  'Solicitamos a inclusão de quatro novas colunas na QRY0730.',
  '',
  'Novas colunas solicitadas:',
  '',
  'LOTE_RECEBIMENTO',
  'MECA_USUARIO',
  '',
  'Objetivo da melhoria:',
  '',
  'Disponibilizar informações complementares dos itens recebidos.',
  '',
  'Comportamento atual:',
  '',
  'Atualmente a consulta não traz lote, validade nem usuário do recebimento.',
  '',
  'Comportamento esperado:',
  '',
  'Manter as colunas atuais e incluir as quatro informações acima.',
].join('\n');
await pagina.getByPlaceholder(/Solicitamos a inclusão/).fill(pedido);
await pagina.getByRole('button', { name: 'Preencher com este texto' }).click();
await pagina.waitForTimeout(400);
const dorLida = await pagina.getByRole('textbox', { name: /Dor atual/i }).first().inputValue();
if (!dorLida.startsWith('Atualmente a consulta')) {
  console.error(`FALHOU: o texto colado não virou a dor atual — "${dorLida}".`);
  process.exitCode = 1;
}
const regrasLidas = await pagina.getByRole('textbox', { name: /Regras de negócio/i }).first().inputValue();
if (!regrasLidas.includes('Novas colunas solicitadas: LOTE_RECEBIMENTO')) {
  console.error(`FALHOU: o bloco sem título conhecido se perdeu — "${regrasLidas}".`);
  process.exitCode = 1;
}
const corpoDoTexto = (await pagina.textContent('body')) ?? '';
if (!corpoDoTexto.includes('Dor atual (AS IS)')) {
  console.error('FALHOU: a tela não mostrou para onde foi cada bloco do texto.');
  process.exitCode = 1;
}
await pagina.screenshot({ path: 'verificacao-texto.png', fullPage: true });

await pagina.getByRole('button', { name: 'Fechar', exact: true }).first().click();
await pagina.waitForTimeout(400);

// Guarda-chuva: quadro de melhorias por situação.
await pagina.getByRole('button', { name: 'Voltar', exact: false }).first().click();
await pagina.waitForTimeout(400);
await pagina.getByText('Melhoria Sistêmica Bseller').first().click();
await pagina.waitForTimeout(800);
await pagina.screenshot({ path: 'verificacao-melhorias.png', fullPage: true });

/* Atualizar a pagina tem de devolver a mesma tela: o endereco guarda o
   projeto aberto, e o F5 nao pode jogar de volta no painel. */
if (!/#\/projeto\//.test(pagina.url())) {
  console.error(`FALHOU: o projeto aberto não foi para o endereço — "${pagina.url()}".`);
  process.exitCode = 1;
}
await pagina.reload({ waitUntil: 'networkidle' });
await pagina.waitForTimeout(1200);
if (!((await pagina.textContent('body')) ?? '').includes('Melhoria Sistêmica Bseller')) {
  console.error('FALHOU: o F5 não manteve o projeto aberto.');
  process.exitCode = 1;
}

/* A esteira em numeros substitui os selos do cabecalho: e por ela que
   se responde quantas melhorias ja foram documentadas e quantas ja
   viraram chamado. */
const corpoDaEsteira = (await pagina.textContent('body')) ?? '';
for (const rotulo of ['Documentadas', 'Concluídas']) {
  if (!corpoDaEsteira.includes(rotulo)) {
    console.error(`FALHOU: a faixa da esteira não trouxe "${rotulo}".`);
    process.exitCode = 1;
  }
}
/* Projeto que nao trabalha com chamado (um estudo, uma obra) nao deve
   carregar dois cartoes travados em zero. Nenhuma melhoria deste
   guarda-chuva tem chamado. */
for (const rotulo of ['Com chamado aberto', 'Prontas para abrir chamado']) {
  if (corpoDaEsteira.includes(rotulo)) {
    console.error(`FALHOU: "${rotulo}" não deveria aparecer num projeto sem chamado.`);
    process.exitCode = 1;
  }
}
/* Os selos continuam em cada linha da lista; o que saiu foi o trio do
   cabecalho, entao a checagem olha so o bloco do titulo. */
const blocoDoTitulo = await pagina.locator('h1.font-titulo').first().locator('xpath=..').innerText();
if (/No prazo|Atenção|Crítico/.test(blocoDoTitulo)) {
  console.error(`FALHOU: o selo de saúde ficou no cabeçalho — "${blocoDoTitulo}".`);
  process.exitCode = 1;
}
/* Avanco pela situacao: "Entrada massiva" esta em andamento, o segundo
   dos cinco passos da esteira padrao, entao a linha mostra 25%. */
const linhaDaMelhoria = await pagina.getByRole('row', { name: /Entrada massiva/ }).first().innerText();
if (!linhaDaMelhoria.includes('25%')) {
  console.error(`FALHOU: a melhoria em andamento deveria avançar pela situação — "${linhaDaMelhoria}".`);
  process.exitCode = 1;
}

/* Chamado e de cada atividade: o projeto que agrupa nao tem o campo,
   e a melhoria de dentro tem. */
if (await pagina.getByPlaceholder('Nº do chamado').count()) {
  console.error('FALHOU: o projeto guarda-chuva não deveria oferecer o campo de chamado.');
  process.exitCode = 1;
}
await pagina.getByText('Entrada massiva').first().click();
await pagina.waitForTimeout(800);
const campoDoChamado = pagina.getByPlaceholder('Nº do chamado').first();
if (!(await campoDoChamado.count())) {
  console.error('FALHOU: a melhoria aberta deveria oferecer o campo do chamado.');
  process.exitCode = 1;
} else {
  await campoDoChamado.fill('987654');
  await campoDoChamado.blur();
  await pagina.waitForTimeout(600);
}
/* Volta para o guarda-chuva pelo caminho de cima, e nao pelo "Voltar",
   que leva para a carteira inteira. */
await pagina.getByRole('button', { name: 'Melhoria Sistêmica Bseller', exact: true }).first().click();
await pagina.waitForTimeout(800);

const textoDoGrupo = (await pagina.textContent('body')) ?? '';
if (!textoDoGrupo.includes('Entrada massiva') || !textoDoGrupo.includes('concluídas')) {
  console.error('FALHOU: a lista de melhorias não montou.');
  process.exitCode = 1;
}
/* O projeto nao pode oferecer marcos, tarefas, paginas nem anexos:
   isso pertence a cada melhoria de dentro. */
for (const secao of ['Marcos', 'Nova tarefa', 'Nova página', 'Arraste arquivos aqui', 'Criar documento']) {
  if (textoDoGrupo.includes(secao)) {
    console.error(`FALHOU: o projeto ainda mostra "${secao}".`);
    process.exitCode = 1;
  }
}
/* A lista abre por padrao, com as colunas de acompanhamento. */
for (const coluna of ['Responsável', 'Prioridade', 'Chamado', 'Início', 'Fim', 'Saúde', 'Avanço']) {
  if (!textoDoGrupo.includes(coluna)) {
    console.error(`FALHOU: a lista de melhorias não tem a coluna "${coluna}".`);
    process.exitCode = 1;
  }
}
await pagina.screenshot({ path: 'verificacao-melhorias.png', fullPage: true });

/* Barra de filtros: nasce fechada e abre pela aba lateral. Filtrar por
   "sem paginas" tem de esconder a melhoria que ja tem documentacao. */
await pagina.getByRole('button', { name: 'Filtros', exact: false }).first().click();
await pagina.waitForTimeout(300);
const comFiltros = (await pagina.textContent('body')) ?? '';
for (const campo of ['Documentação', 'Documentada', 'Por formato', 'Páginas', 'Documento Word', 'Fim']) {
  if (!comFiltros.includes(campo)) {
    console.error(`FALHOU: a barra de filtros não tem "${campo}".`);
    process.exitCode = 1;
  }
}
await pagina.screenshot({ path: 'verificacao-filtros.png', fullPage: true });

/* Configuracao das situacoes: so administrador ve o botao, e ele abre
   a janela com as seis situacoes para ligar, renomear e colorir. */
await pagina.getByRole('button', { name: 'Situações', exact: false }).first().click();
await pagina.waitForTimeout(400);
const configuracao = (await pagina.textContent('body')) ?? '';
for (const campo of ['Situações das atividades', 'Nova situação', 'Em risco', 'Concluída', 'esteira do módulo']) {
  if (!configuracao.includes(campo)) {
    console.error(`FALHOU: a configuração de situações não tem "${campo}".`);
    process.exitCode = 1;
  }
}
/* Esteira propria do projeto: separar do modulo grava na chave dele, e
   a janela passa a dizer que o que se mexe ali nao sai deste projeto. */
await pagina.getByRole('button', { name: 'Criar esteira só deste projeto' }).click();
await pagina.waitForTimeout(700);
const depoisDeSeparar = (await pagina.textContent('body')) ?? '';
if (!depoisDeSeparar.includes('Voltar a usar a do módulo')) {
  console.error('FALHOU: o projeto deveria ficar com esteira própria depois de separar do módulo.');
  process.exitCode = 1;
}
if (!configuracoes.some((c) => c.chave.startsWith('status_projeto:'))) {
  console.error(`FALHOU: a esteira do projeto não foi gravada na chave dele — ${JSON.stringify(configuracoes.map((c) => c.chave))}.`);
  process.exitCode = 1;
}

await pagina.screenshot({ path: 'verificacao-config-status.png', fullPage: true });

/* Ordem das colunas: as setas do cabecalho do quadro gravam a
   configuracao, entao a coluna tem de continuar no lugar novo depois da
   releitura. */
await pagina.keyboard.press('Escape');
await pagina.waitForTimeout(300);
await pagina.getByRole('button', { name: 'Quadro', exact: true }).first().click();
await pagina.waitForTimeout(400);
const tituloDaColuna = async (i) =>
  (await pagina.locator('[data-quadro="colunas"] .w-64 .uppercase').nth(i).innerText()).trim();
const primeira = await tituloDaColuna(0);
const segunda = await tituloDaColuna(1);
await pagina.getByTitle(`Mover ${segunda} para a esquerda`).click();
await pagina.waitForTimeout(700);
if (await tituloDaColuna(0) !== segunda || await tituloDaColuna(1) !== primeira) {
  console.error(`FALHOU: a coluna não trocou de lugar — ficou "${await tituloDaColuna(0)}, ${await tituloDaColuna(1)}".`);
  process.exitCode = 1;
}
/* A barra de rolagem lateral do quadro nao pode viver no fim da pagina:
   a caixa das colunas tem altura propria e rola por dentro. */
const caixaDasColunas = pagina.locator('[data-quadro="colunas"]').first();
const rolagem = await caixaDasColunas.evaluate((el) => ({
  altura: el.clientHeight,
  conteudo: el.scrollHeight,
  limite: getComputedStyle(el).maxHeight,
}));
if (!rolagem.limite.endsWith('px')) {
  console.error(`FALHOU: o quadro deveria ter altura limitada — max-height "${rolagem.limite}".`);
  process.exitCode = 1;
}
/* Recolher coluna: vira uma faixa fina, e a escolha fica guardada. Com
   muitas situacoes e o que evita a rolagem lateral. */
const primeiraColuna = pagina.locator('[data-quadro="colunas"] .w-64').first();
const larguraAberta = (await primeiraColuna.boundingBox())?.width ?? 0;
await pagina.getByTitle(/^Recolher /).first().click();
await pagina.waitForTimeout(400);
const faixa = pagina.locator('[data-quadro="colunas"] .w-10').first();
const larguraRecolhida = (await faixa.boundingBox())?.width ?? 0;
if (!(larguraRecolhida > 0 && larguraRecolhida < larguraAberta)) {
  console.error(`FALHOU: recolher a coluna não encolheu nada (${larguraAberta} → ${larguraRecolhida}).`);
  process.exitCode = 1;
}
if (!(await pagina.evaluate(() => (localStorage.getItem('projetos.colunas-recolhidas') ?? '').length > 2))) {
  console.error('FALHOU: a coluna recolhida deveria ser lembrada no navegador.');
  process.exitCode = 1;
}
await pagina.screenshot({ path: 'verificacao-quadro.png', fullPage: true });
await faixa.click();
await pagina.waitForTimeout(300);
if (!(await pagina.locator('[data-quadro="colunas"] .w-10').count() === 0)) {
  console.error('FALHOU: clicar na faixa deveria abrir a coluna de novo.');
  process.exitCode = 1;
}
await pagina.getByRole('button', { name: 'Lista', exact: true }).first().click();
await pagina.waitForTimeout(300);

await pagina.getByRole('button', { name: 'Projetos', exact: true }).click();
await pagina.getByText('Reendereçamento do mezanino').first().click();
await pagina.waitForTimeout(700);

const texto = (await pagina.textContent('body')) ?? '';
if (!texto.includes('Marcos') || !texto.includes('Migração dos itens')) {
  console.error('FALHOU: o detalhe do projeto não carregou marcos.');
  process.exitCode = 1;
} else if (!texto.includes('Endereço existe?')) {
  console.error('FALHOU: o fluxo desenhado não apareceu na página.');
  process.exitCode = 1;
} else if (!texto.includes('Aprovada')) {
  console.error('FALHOU: a página não mostra a situação.');
  process.exitCode = 1;
} else if (!texto.includes('Comportamento da tela de endereço') || !texto.includes('Busca de endereço')) {
  console.error('FALHOU: a seção de páginas não carregou o conteúdo.');
  process.exitCode = 1;
} else if (!texto.includes('Documentos') || !texto.includes('Criar documento')) {
  console.error('FALHOU: a seção de documentos não apareceu.');
  process.exitCode = 1;
} else if (!texto.includes('Antes e depois') || !texto.includes('plano-de-endereços.pdf')) {
  console.error('FALHOU: a seção de anexos não montou a comparação ou a lista de documentos.');
  process.exitCode = 1;
} else if (erros.length) {
  console.error('FALHOU: erros de JavaScript', erros);
  process.exitCode = 1;
} else {
  console.log('OK: painel, carteira, cronograma, pessoas e detalhe renderizados sem erros.');
}

/* Sem sessao guardada, a mesma tela tem de parar no login: e a
   garantia de que o modulo deixou de ser aberto. */
const anonima = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
await anonima.route('**/auth/v1/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
await anonima.route('**/rest/v1/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
await anonima.goto(url, { waitUntil: 'networkidle' });
await anonima.waitForTimeout(800);
const semLogin = (await anonima.textContent('body')) ?? '';
if (!semLogin.includes('acesso restrito') || semLogin.includes('Cronograma')) {
  console.error('FALHOU: sem sessão o módulo deveria parar na tela de acesso.');
  process.exitCode = 1;
}
await anonima.screenshot({ path: 'verificacao-acesso.png', fullPage: true });

await navegador.close();
