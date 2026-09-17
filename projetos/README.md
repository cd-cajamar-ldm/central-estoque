# Módulo de Projetos — Central de Estoque

Acompanhamento de projetos e iniciativas do CD Cajamar: carteira, marcos,
tarefas, histórico de acompanhamento, painel e cronograma.

Diferente dos outros módulos da Central, os dados **não** ficam no navegador:
são compartilhados por toda a equipe em um banco Supabase — e, também diferente
do restante da Central, **o acesso exige login**: e-mail e senha, com papel
(admin, editor, leitor) definido no cadastro de Pessoas.

- Fonte: `projetos/` (React + Vite + TypeScript + Tailwind)
- Publicado em: `acompanhamento-projetos/` (servido pelo GitHub Pages)
- Endereço: https://danilolimamts.github.io/central-estoque/acompanhamento-projetos/

## Largura da tela

O miolo acompanha o monitor até 1760 px (`max-w-tela`, em `tailwind.config.js`):
em 1240 px sobrava um terço de cinza dos dois lados no monitor do escritório e o
quadro de atividades mostrava só duas colunas. O teto existe para a linha da
tabela não virar uma faixa perdida em monitor ultralargo.

A coluna de texto das páginas continua parando em ~90 caracteres (`.prosa`):
numa linha de 1700 px o olho perde o começo da próxima. O quadro de fluxo, que
fica fora da prosa, usa a largura toda.

## Comandos

```bash
npm install
npm run dev            # desenvolvimento
npm test               # regras de prazo, saúde e indicadores
npm run typecheck
npm run build
npm run publicar       # build + cópia para ../acompanhamento-projetos
npm run verificar:tela  # build + smoke test da tela inicial (precisa de um servidor local)
npm run verificar:telas # idem, com a API simulada: painel, carteira, cronograma e detalhe
```

## Banco de dados

Projeto Supabase: **Estoque Project** (`jfvnswafpeshyfweoadg`), região `sa-east-1`.
As tabelas ficam no schema `projetos`, separadas dos demais módulos do mesmo
banco. As migrations aplicadas estão em `supabase/migrations/`.

| Tabela | Papel |
|---|---|
| `pessoas` | quem tem acesso, com papel (`admin`, `editor`, `leitor`) |
| `projetos` | a carteira: datas previstas/reais, situação, prioridade, avanço |
| `marcos` | etapas com data prevista e data real |
| `tarefas` | itens de execução, com responsável e prazo |
| `atualizacoes` | histórico de acompanhamento; nunca sobrescrito |
| `anexos` | fotos e documentos, com o par antes/depois |
| `paginas` | documentação do projeto em blocos de texto e fluxograma |
| `paginas_versoes` | versão anterior de cada página, gravada a cada salvamento |
| `documentos` | Propostas de Melhoria Sistêmica, com as 15 seções em jsonb |
| `configuracoes` | ajustes da equipe em chave/valor (hoje: as situações) |

### Anexos

Arquivos ficam no bucket `anexos-projetos` do Storage (público na leitura,
15 MB por arquivo, imagens e documentos de escritório). A tabela `anexos`
guarda só o caminho — a URL pública é derivada dele, então trocar de projeto
Supabase não quebra os links.

Antes de subir, imagem maior que 1600 px é redimensionada e recomprimida no
próprio navegador; foto de celular cai de alguns MB para algumas centenas de
KB. O plano free dá 1 GB de armazenamento.

O campo `momento` classifica cada anexo em **antes**, **depois**, **evidência**
ou **documento**; o campo `par` nomeia a cena e é o que liga um antes ao seu
depois na galeria comparativa. Anexo lançado junto com um acompanhamento fica
preso a ele (`atualizacao_id`) e aparece dentro do próprio reporte.

### Projeto e atividades

Abrir um projeto mostra **a lista do que há para fazer dentro dele**, não o
trabalho em si. Cada linha é uma atividade, com responsável, situação,
prioridade, prazo, saúde e avanço editáveis ali mesmo; abrir a atividade leva à
tela cheia, onde vivem marcos, tarefas, páginas, anexos e o documento em Word.

As duas datas da linha têm donos diferentes: **Início** é a data real, digitada
por quem fez o trabalho ("quando documentei"), e **Fim** é o prazo, que no
Bseller vem de fora — por isso só ele carrega o aviso de atraso. O cronograma
aceita as duas: sem data prevista, ele desenha a barra com a data real.

A lista vem ordenada **por prioridade** (crítica, alta, média, baixa; prazo mais
curto desempata), que é a ordem em que se decide o que fazer agora. O seletor
*Ordenar* troca para prazo, situação ou nome.

### Avanço: não se digita, se conclui

Não há campo de percentual em lugar nenhum — nem na linha da atividade, nem no
cadastro, nem no lançamento de acompanhamento. O número sai da situação:

- **atividade** (sem nada dentro): concluída vale 100%, o resto vale 0%;
- **projeto**: atividades concluídas / atividades que valem (canceladas fora);
- **carteira** (painel): mesma conta sobre todos os projetos e atividades.

A conta é feita na leitura (`listarProjetos`), então painel, cronograma,
planilha e semáforo mostram o mesmo número da lista, sem cada um refazer a
conta e sem depender de uma coluna que envelheceria a cada mudança de situação.
A coluna `percentual` do banco continua lá, mas nada mais escreve nela.

O semáforo de saúde só cobra **ritmo** de quem tem atividades dentro — ali o
percentual mede entrega parcial. Numa atividade solta o avanço é 0 até ela
terminar, então comparar com o esperado marcaria "atenção" em tudo que passou
de um quinto do prazo; lá quem cobra é a data.

Isso é uma coluna `projeto_pai_id` na própria tabela de projetos: a atividade é
um projeto filho e herda tudo o que o projeto já sabe fazer, sem uma entidade
nova pela metade. Não há configuração: projeto de topo é sempre a pasta,
atividade é sempre o trabalho.

O nome das atividades vem do campo `rotulo_filhos` do projeto: "Melhorias" no
Bseller, "Frentes" ou "Etapas" em outro, "Atividades" quando ninguém escolhe. O
singular e o gênero saem do plural, para o botão sair "+ Nova melhoria", não
"+ Novo melhoria".

Consequências no resto do módulo:

- a **carteira** lista só os projetos de topo, com o número de atividades ao lado
  do nome (a caixa *Incluir melhorias* abre a lista plana);
- **painel** e **cronograma** contam apenas as folhas, para o projeto e as
  atividades dentro dele não contarem o mesmo trabalho duas vezes;
- o projeto mostra o **avanço pela conclusão**: quantas atividades já estão
  concluídas sobre o total, ignorando as canceladas;
- projeto antigo que tinha marcos ou tarefas próprios continua mostrando o que
  já tinha, para nada se perder.

### Chamado no BSeller

Cada atividade guarda o **chamado** que a originou (`chamado`, o número da
central de ajuda), o **link** dele e o **ticket do Jira**, quando o time do
BSeller abre um. Sem isso, a ligação entre o que está aqui e o que está lá vive
na cabeça de quem abriu — e some quando alguém pergunta "em que pé está o
145537?".

O número é editável direto na linha da lista (grava ao sair do campo, como as
datas), aparece no cabeçalho da atividade com link para abrir o chamado, entra
na planilha exportada e preenche o campo *Documento relacionado* da proposta em
Word.

### Filtros das atividades

Ao lado da lista há uma barra retrátil (nasce fechada; a escolha fica no
`localStorage` do navegador, porque o quadro precisa da largura toda quando
ninguém está filtrando). Ela filtra por:

- **documentação** — o filtro de cima, e o que se pergunta no dia a dia:
  documentada é a atividade que tem página escrita aqui, proposta gerada aqui
  **ou** arquivo anexado. O formato não importa; tarefa e marco não contam,
  porque são execução, não registro;
- **por formato** — páginas, documento Word, tarefas, marcos e anexos separados,
  para quem quiser cortar mais fino. Todos em três estados: tanto faz, **com**
  ou **sem** — uma caixa marcada só responderia metade da pergunta;
- situação, prioridade, responsável, prazo (vencidas, vencem em 7 dias, sem
  prazo) e busca por nome/código/descrição, sem acento e sem caixa.

As contagens vêm de cinco consultas de uma coluna só (`estado/conteudo.ts`),
limitadas às atividades do projeto aberto — baixar páginas e anexos inteiros só
para contar linha seria caro. A coluna **Conteúdo** da lista (e uma linha no
cartão do quadro) mostra as mesmas contagens em três letras: o filtro esconde a
atividade, e a marca explica por quê.

### Situações configuráveis

O botão **⚙ Situações**, no cabeçalho da lista de atividades (só para admin),
cria situações novas, renomeia, escolhe cor, ordem e liga/desliga cada uma. A
equipe nomeia o próprio processo: "Aguardando Bseller", "Em homologação".

Cada situação tem um **significado**, e é ele que muda conta:

| significado | efeito |
|---|---|
| em aberto | trabalho pendente (o padrão de qualquer situação nova) |
| concluída | entra no avanço e encerra a atividade |
| cancelada | sai da conta do avanço |

Sem isso, criar "Entregue" deixaria o avanço e o semáforo de saúde errados —
eles perguntam "isto está encerrado?", não "o nome é concluído?".

A coluna `status` era um tipo fechado do Postgres e virou texto (`015`): a
garantia de não gravar situação inválida passou do banco para a tela, que só
oferece o que está configurado. É o preço de deixar a equipe criar as suas.

Duas travas: situação **com atividade dentro não pode ser removida** (mova as
atividades antes, ou desmarque *Usar* para escondê-la sem perder nada), e
situação gravada que não está mais na configuração continua aparecendo, com a
própria chave, contando como trabalho aberto.

A configuração vive em `configuracoes` (chave `status_projeto`), vale para todo
mundo e só administrador grava. O domínio lê de um registro em
`dominio/situacoes.ts`, e não de contexto de React, porque quem pergunta
"encerrado?" são funções puras (prazo, avanço, planilha).

Situação desligada **continua aparecendo enquanto houver atividade nela**, e o
seletor da linha sempre inclui a situação atual daquela linha. Sem isso o cartão
sumiria do quadro sem explicação, ou uma troca sem querer viraria escrita.

A visão **Lista/Quadro** também é lembrada (no navegador de cada um): quem
prefere o quadro não reescolhe a cada projeto aberto.

### Quadro (arrastar e soltar)

As melhorias de um grupo e as tarefas de um projeto aparecem em colunas por
situação, e o cartão muda de situação ao ser arrastado — no espírito do Jira.
Usa a API de arrastar do próprio navegador, sem biblioteca. No celular não há
arrastar, por isso todo cartão continua tendo o seletor de situação na visão em
lista, que é o caminho garantido.

### Páginas

Cada projeto tem páginas próprias — a folha onde se descreve o comportamento de
uma tela, com print no meio do texto e fluxograma logo abaixo.

Uma página é uma lista ordenada de blocos, guardada inteira em um `jsonb`: o
salvamento fica atômico e reordenar bloco não vira várias escritas que podem
falhar pela metade. Dois tipos de bloco:

- **texto** — editor rico (TipTap): títulos, listas, citação, código, link,
  tabela e imagem. Print colado com Ctrl+V é enviado para o Storage e entra como
  URL, nunca como base64 dentro do HTML.
- **fluxo** — quadro de desenho livre, no espírito do Miro: a barra cria blocos
  (início/fim, etapa, decisão, círculo, triângulo, anotação), cada bloco é
  arrastado com o mouse, tem texto e cor próprios, e *Ligar a outro* traça a
  seta entre dois blocos. O quadro é guardado como JSON — blocos e ligações,
  com posição —, e as setas saem sempre da borda mais próxima, então mover um
  bloco reacomoda o desenho sozinho.

#### O quadro de fluxo no dia a dia

- **cor antes da forma** — a fileira de cores ao lado dos botões de forma diz
  com que cor o próximo bloco nasce (a escolha fica no navegador). A equipe
  desenha sempre com as mesmas poucas cores; escolher uma vez e sair criando
  evita repintar bloco a bloco depois.
- **zoom** — os botões `−  100%  +` (e Ctrl + roda do mouse) aproximam e afastam
  o desenho inteiro: o fluxo todo numa tela para achar o caminho, de perto para
  escrever. Antes esses botões mexiam no tamanho da prancheta — o número crescia,
  o desenho ficava igual e ninguém entendia o que tinha mudado. O chão em volta
  do desenho agora é uma folga fixa, sem botão.
- **seta recolhida** — o rótulo (`Sim`/`Não`), o traço e o ✕ só aparecem na seta
  selecionada; fechada, ela mostra um ponto discreto no meio. Abertos em toda
  seta, os campos vazios tapavam o desenho, e na maioria dos fluxos ninguém
  escreve neles.
- **desfazer** — Ctrl+Z e Ctrl+Y (ou Ctrl+Shift+Z), e os botões `↶ ↷` na barra,
  andam nos últimos 50 passos. Um arrasto inteiro conta como um passo só, e
  trocar de página zera o histórico — desfazer ali devolveria o desenho de outra
  página por cima desta.
- **vários blocos e alinhar** — Shift+clique junta e tira blocos da seleção,
  Ctrl+A pega todos. Com dois ou mais, a barra troca as propriedades do bloco
  pelos seis alinhamentos (`⇤ ↔ ⇥ ⤒ ↕ ⤓`): todos vão até a mesma borda do grupo,
  ou ao meio entre as bordas extremas — e não à média das posições, que com
  larguras diferentes puxaria a coluna para o lado de quem tem mais vizinhos.
  Arrastar ou empurrar com as setas move o grupo inteiro mantendo as distâncias;
  clicar num bloco do grupo sem arrastar volta a escolher só ele, e a troca
  acontece ao soltar o botão, porque no mousedown ainda não se sabe se o gesto
  é clique ou arrasto.

- **copiar, recortar e colar** — Ctrl+C, Ctrl+X e Ctrl+V (e os botões na barra)
  sobre os blocos escolhidos. A área de transferência é do próprio quadro: o
  Ctrl+V do sistema já tem dono aqui (colar print), então colar bloco só entra
  em ação quando não veio imagem nenhuma junto. O recorte leva as setas **entre**
  os blocos copiados, e só elas — uma seta que sai do grupo não teria de onde
  sair depois de colada. A cópia entra deslocada 30 px, e colar de novo cai mais
  adiante, em vez de voltar ao mesmo lugar.

#### Compartilhar a página

O botão **Compartilhar**, ao lado de *Histórico*, baixa a página como um único
arquivo `.html` (`src/exportar/paginaHtml.ts`): texto e fluxogramas na ordem em
que foram escritos, o fluxo desenhado em SVG dentro do próprio arquivo e o print
colado dentro do SVG. Abre em qualquer navegador, sem internet e sem login — é
assim que a documentação chega a fornecedor ou ao time do BSeller, que não têm
acesso ao módulo. O estilo vai embutido, pelo mesmo motivo.

O que sai é o que está na tela, e não o que está no banco: quem acabou de
escrever espera mandar o que acabou de escrever. O HTML do texto passa pela
mesma limpeza da tela (`limparHtml`, injetada de fora para a função de exportar
continuar pura e testável sem navegador), e fluxo no formato antigo vai como
texto em vez de sumir do arquivo.

Três decisões sobre como o arquivo se lê:

- **as imagens vão embutidas** (`embutirImagens`). O print do texto mora no
  Storage e aparece por URL; num arquivo que vai por e-mail isso é uma imagem
  quebrada assim que quem abre estiver sem rede — e "abre sem internet" era a
  razão de existir do botão. Imagem que não baixa fica com a URL, em vez de
  derrubar o compartilhar;
- **o desenho é recortado no conteúdo** (`limitesJustos`, `fluxoParaSvg(…, { justo: true })`).
  A prancheta da tela tem chão de sobra para arrastar bloco, e esse chão virava
  meia folha em branco embaixo do fluxo. O documento em Word continua no
  enquadramento de sempre, para o desenho não mudar de tamanho de uma proposta
  para a outra;
- **o fluxo vem em tamanho real**, com rolagem lateral quando não cabe, e um
  controle *Ajustar à largura da página* ao lado. Encolhido para caber, o texto
  dentro das caixas fica ilegível; o desenho é vetorial, então nos dois tamanhos
  continua nítido. O controle é um checkbox com rótulo em forma de botão, sem
  uma linha de script: o arquivo abre em navegador de terceiro, às vezes com
  script bloqueado. Na impressão ele some e o fluxo cabe na folha.

Cada página tem **situação** própria: rascunho, em revisão, aprovada, concluída
ou cancelada. O seletor fica no canto superior direito da página e grava na hora,
sem passar pelo modo de edição; a lista da esquerda mostra o selo colorido de
cada uma, para saber o que já vale sem precisar abrir.

Cada salvamento grava a versão anterior em `paginas_versoes`, e o botão
*Histórico* restaura qualquer uma delas (a restauração só preenche o editor — o
salvamento continua explícito).

O HTML é limpo na hora de exibir (`src/lib/html.ts`), não só ao salvar: como o
módulo é aberto, alguém poderia gravar `<script>` direto pela API.

O editor de texto pesa alguns MB e entra por carregamento sob demanda — quem só
consulta o painel não baixa nada disso. O quadro de fluxo é SVG desenhado à mão,
sem biblioteca; o Mermaid só é carregado quando aparece um fluxo antigo.

### Documentos (Proposta de Melhoria Sistêmica)

O botão **Criar documento**, no detalhe do projeto, monta a proposta no padrão
Bseller e baixa o `.docx`: capa, 15 seções, cabeçalho com logo, rodapé com
"Página X de Y" e nome de arquivo `NN__Proposta_Melhoria_Sistemica_[Nome].docx`.
A geração é feita no próprio navegador com a biblioteca `docx`, sem servidor.

O formulário nasce preenchido com o que o projeto já sabe: título, categoria
(a área), prioridade e as fases de implantação (os marcos). Prints dos anexos
entram nas seções AS IS, TO BE ou nos anexos do fim, e os fluxogramas das
páginas viram imagem na seção 7 — o quadro é convertido em SVG e rasterizado no
navegador; fluxo do formato antigo, em texto, continua sendo desenhado pelo
Mermaid, para documento antigo não sair sem ele.

**Gerar rascunho.** Preenchidos objetivo, dor atual, o que muda e problema
central, o botão escreve as demais seções recombinando esses textos e o que o
projeto já tem: ganhos, impactos, riscos, critérios de aceite, KPIs, rollout,
ROI e resumo executivo. Não é IA e não inventa conteúdo: onde não há base, deixa
a marcação de pendência, porque uma frase bonita e falsa é pior do que um "a
definir" honesto. Campo já escrito nunca é sobrescrito.

**Ponte com o chat (opcional).** O site é estático e não guarda chave de IA, então ele não
escreve o texto das seções. O botão *Copiar briefing* monta um texto com o
objetivo mais todo o contexto do projeto (marcos, tarefas, anexos, páginas) e o
JSON esperado de volta; cola-se no chat e o retorno entra pelo *Colar conteúdo*.
Número, imagens e fluxogramas nunca vêm de fora: são decididos no formulário.

Listas e tabelas são editadas como texto, uma linha por item e colunas separadas
por barra (`Dimensão | Ganho`). Travessão é trocado na geração, porque a
especificação o proíbe no conteúdo.

Esses campos guardam o próprio texto enquanto estão em foco. Ligados direto no
valor convertido, o espaço sumia no instante em que era digitado — a volta
lista → texto apara espaços, e "Tela no bseller" virava "Telanobseller". O valor
de fora só entra quando ninguém está escrevendo, que é o caso de *Gerar
rascunho* e *Colar conteúdo*.

### Publicação nova com a aba aberta

Cada publicação troca o hash dos pedaços do bundle. A aba que ficou aberta
continua com o index antigo e, ao pedir um pedaço sob demanda (gerador de Word,
planilha, editor), busca um arquivo que não existe mais: *Failed to fetch
dynamically imported module*. `lib/importar.ts` intercepta isso e recarrega a
página uma vez — com trava em `sessionStorage`, para não entrar em laço quando a
falha for outra coisa, como internet caída.

**O arquivo fica anexado.** *Gerar Word e anexar* salva o documento, baixa o
`.docx` e o guarda nos Anexos da atividade, sempre no mesmo caminho
(`<projeto>/documentos/<documento>.docx`): gerar de novo **substitui** a versão
anterior e atualiza a mesma linha, em vez de empilhar cópias com nomes
parecidos. Assim "o documento" é sempre um só, e quem abre a atividade acha a
última versão sem escolher entre três arquivos iguais.

O salvamento acontece **antes** da geração: se a geração falhar (imagem que não
baixa, versão nova do app numa aba antiga), o que foi preenchido não se perde
junto.

**Rascunho no navegador.** O formulário é longo e só vira registro quando
alguém salva ou gera. Até lá, fechar a aba, cair a internet ou dar erro na
geração levava embora tudo o que foi digitado — foi o que aconteceu na primeira
proposta escrita de verdade. Agora cada tecla é guardada no `localStorage`, e ao
reabrir o formulário a tela **oferece** o que ficou pela metade, com data e
autor: *Recuperar* ou *Descartar*. Nunca aplica sozinho — sobrescrever o que
está na tela sem perguntar seria pior do que a perda que isso evita. Salvou no
banco, o rascunho local é apagado. Fica no navegador de quem escreveu, não no
banco: é trabalho ainda não entregue.

O índice geral (documento `00`) ainda não é gerado.

### Acesso

O módulo exige login (e-mail e senha, Supabase Auth). Estar logado **não** é o
mesmo que ter acesso: qualquer e-mail consegue criar conta, mas só lê a carteira
quem tem cadastro **ativo** em `pessoas` ligado àquele login. Quem entra sem
cadastro vê a tela "acesso ainda não liberado" em vez de uma carteira vazia.

O vínculo é automático: um gatilho em `auth.users` liga o login novo ao cadastro
de mesmo e-mail (`vincular_novo_usuario`). Por isso a ordem é: **primeiro** o
administrador cadastra a pessoa em Pessoas com o e-mail exato, **depois** ela
faz o primeiro acesso. O primeiro usuário do módulo nasce admin, senão não
haveria quem cadastrasse os demais.

O que cada papel pode (`002`, revisado em `012`):

| | leitor | editor | admin |
|---|---|---|---|
| ver tudo | sim | sim | sim |
| criar projeto ou atividade | não | sim | sim |
| editar | não | só o que ele mesmo criou | qualquer um |
| excluir projeto | não | não | sim |
| cadastrar pessoas e trocar papéis | não | não | sim |

A régua é a **autoria**, não o responsável: quem recebe o link acompanha tudo e
mexe só no que lançou. A coluna `criado_por` é preenchida por um gatilho, nunca
pelo app — assim vale também para linha criada por fora da tela, e ninguém se
declara autor de outra pessoa. Projeto criado na época do acesso aberto não tem
autor, então só o admin edita.

Marcos, tarefas, páginas, anexos e documentos seguem a regra do projeto a que
pertencem. Acompanhamento é do autor: só ele corrige o que lançou (e o admin
apaga). Um gatilho impede autopromoção — ninguém muda o próprio papel.

Arquivo segue o caminho: o balde é um só, e a permissão sai do prefixo, que
começa pelo id do projeto (`<projeto>/arquivo` nos anexos,
`paginas/<projeto>/arquivo` nas imagens do texto). Sem isso qualquer pessoa
logada apagaria o arquivo de qualquer projeto, mesmo sem poder apagar a linha
que aponta para ele.

A tela repete a mesma regra — botão que vai ser recusado não aparece, campo de
linha alheia fica travado, e o cartão do quadro avisa em vez de voltar sozinho.
Quem protege continua sendo a policy; a tela só evita o erro.

Arquivos: enviar e apagar exigem login; a **leitura continua pública**, porque o
balde é público e a página exibe a miniatura direto pela URL (um UUID
aleatório). Fechar a leitura exigiria URL assinada em todo lugar — página,
documento e exportação — e quebraria os links já gravados.

#### A tela só pede dado depois da sessão

`useCarteira` e `useConfiguracao` recebem um sinal de "sessão resolvida" e não
consultam nada antes dele. Sem essa espera, o primeiro render dispara as
consultas antes de o supabase-js ler o token guardado no navegador: elas chegam
ao banco como visitante, o `anon` não tem grant nenhum desde `011`, e a tela
abre vazia com aviso de permissão — mesmo com a pessoa logada. Em máquina
rápida a corrida costuma dar certo; em máquina fria, não.

Por isso também há duas mensagens diferentes para o mesmo código de erro do
Postgres: `permission denied for table` é sessão que não chegou (recarregue,
entre de novo), e a negativa de policy é falta de direito sobre aquela linha.

#### Como voltar a abrir o módulo

Recriar as policies de `anon` (o conteúdo de `003_acesso_aberto.sql`) e devolver
o grant:

```sql
grant select, insert, update, delete on all tables in schema projetos to anon;
create policy projetos_aberto on projetos.projetos for all to anon using (true) with check (true);
-- e assim por diante para pessoas, marcos, tarefas, atualizacoes, anexos,
-- paginas, paginas_versoes e documentos
```

## Configuração no painel do Supabase (uma vez só)

1. **Settings → API → Exposed schemas**: adicionar `projetos` à lista (o padrão
   traz só `public`). Sem isso o app recebe erro de schema inexistente.
2. **Authentication → URL Configuration**: só importa se o login voltar a ser
   exigido. Já está preenchido com o endereço publicado.

## Apontar para outro projeto Supabase

`src/lib/supabase.ts` traz URL e chave padrão embutidas, mas ambas podem ser
trocadas por variáveis de ambiente na hora do build:

```bash
VITE_SUPABASE_URL=https://xxx.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_xxx npm run publicar
```

## Como as regras de prazo funcionam

- **Atraso**: dias passados do fim previsto, contados só para projeto não encerrado.
- **Avanço esperado**: quanto do prazo já correu. Aparece como marca cinza na
  barra de progresso — o avanço abaixo dessa marca significa ritmo atrasado
  mesmo sem estourar a data.
- **Saúde**: `crítico` quando está em risco ou passou do prazo; `atenção` quando
  o projeto está 20 pontos ou mais atrás do esperado (só para quem tem
  atividades dentro), pausado, ou vence em até 7 dias;
  `no prazo` no restante; `encerrado` para concluído e cancelado.

As cores de situação passaram pelo validador de daltonismo do guia de dataviz
(faixa de luminosidade, piso de croma e separação entre vizinhos). Nenhum
gráfico usa cor como código único: sempre há rótulo e valor.
