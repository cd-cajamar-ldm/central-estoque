# RG Reversa — instruções permanentes

- **A cada alteração no app (dashboard ou coletor), suba a versão**: aumente `n` e atualize `data`
  em `rg-reversa/js/versao.js`, e troque o `?v=<n>` antigo pelo novo nos dois `index.html`
  (`rg-reversa/index.html` e `rg-reversa/coletor/index.html`). Sem isso o navegador/leitor
  reaproveita arquivos antigos e a versão no rodapé não muda.
- A versão aparece no rodapé do dashboard e do coletor ("RG Reversa · v<n> · <data>") e é ela que
  mostra, no aparelho, se a alteração já subiu. Não dependa do `version.js` da raiz: o GitHub Pages
  desta conta também publica a branch crua, e isso apaga o carimbo do deploy.
- Depois de publicar, confira que a execução "pages build and deployment" do commit mesclado terminou com sucesso.
- **Níveis de acesso** (definidos por pessoa em Configurações do hub): *Pode editar* faz tudo (importar relatórios,
  apagar dados, coletor). *Só visualizar* consulta o dashboard e usa o **coletor** (as bipagens continuam sendo
  gravadas), mas não vê a Importação e o banco recusa importar/apagar. É um desvio consciente da regra geral do
  repositório, porque os assistentes usam o coletor. As políticas estão em
  `rg-reversa/supabase/migrations/004_nivel_visualizar.sql` (rodar à mão no SQL Editor do Supabase).
- **Tempo em misto** (Dashboard: cartão "Tempo em misto" e os gráficos "Há quanto tempo estão mistos" / "Mistos há mais tempo"):
  a tabela `rg_misto` guarda cada período em que um local ficou misto (RG + peça sem RG). Quem *pode editar* alimenta o
  histórico sozinho (na primeira abertura e a cada importação de QRY0100/QRY0390). Sem histórico, o dashboard usa uma
  estimativa pela idade do RG e da peça sem RG. Zonas TRI e PIC ficam de fora (`SEM_MONITOR` em `js/app.js`). Tabela criada
  à mão com `rg-reversa/supabase/migrations/005_misto_historico.sql`. Não há aba própria para isso.
