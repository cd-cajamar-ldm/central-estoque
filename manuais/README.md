# Manuais — passo a passo animado

App da Oficina LDM para montar manuais de configuração no estilo "assista e repita".

- **Biblioteca** (`index.html`): lista os manuais guardados neste navegador (IndexedDB).
- **Editor**: cada etapa tem prints reais (Ctrl+V, arrastar ou "Nova tela") e um roteiro de
  ações marcadas sobre o print — *Clique*, *Botão direito*, *Digitar* e *Destacar* — com a
  legenda que aparece embaixo da tela e uma explicação detalhada opcional (a animação espera o
  tempo de leitura). Em "Dados do manual" dá para escolher o fundo atrás do print (bancada,
  claro, branco, laranja, grafite, sem fundo ou uma cor). Também tem "o que fazer", valores para copiar,
  observação e um campo opcional que o leitor preenche (`{{chave}}`).
- **Tecla** (ENTER, F4, Ctrl+V…) e **Cena do físico** — animações sem print para treinamento:
  separar o palete por SKU, bipar unidade por unidade (com contador e bip) e conferir físico x bipado.
- **Modo treinamento** (🎯 Treinar no player): a pessoa faz cada clique, digitação, escolha e tecla;
  erro mostra aviso e, no 2º erro, a dica. No fim mostra quantas acertou de primeira.
- **Quiz final**: perguntas de múltipla escolha cadastradas no editor, com explicação e nota.
- **Exportar manual (.html)**: gera um arquivo único, com player e prints embutidos, que abre
  offline e pode ir por Teams/e-mail. **Salvar projeto (.json)** guarda o projeto para editar em
  outro computador (Importar projeto).

## Senhas
Pela política da LDM, senha não fica salva em arquivo. O editor detecta padrões como
`-pw algo` ou `senha: algo` e, enquanto houver, não salva nem exporta. Use um marcador em
maiúsculas com `_` (ex.: `SENHA_STG`), que aparece destacado para o leitor trocar.

## Arquivos
- `js/player.js` + `css/player.css`: o player (vai embutido em cada manual exportado).
- `js/app.js` + `css/app.css`: biblioteca, editor e exportação.
- `exemplos/como-montar.json` + `exemplos/como-montar/*.webp`: manual oficial "Como montar um manual"
  (botão ❓ na Biblioteca e ❓ Ajuda no editor). Prints recapturáveis com o script de captura do editor.
- `exemplos/putty-stg.json` + `exemplos/putty-stg/*.webp`: manual de exemplo (PuTTY STG),
  carregado automaticamente na primeira vez.
