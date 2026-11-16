# RG Reversa — instruções permanentes

- **A cada alteração no app (dashboard ou coletor), suba a versão**: aumente `n` e atualize `data`
  em `rg-reversa/js/versao.js`, e troque o `?v=<n>` antigo pelo novo nos dois `index.html`
  (`rg-reversa/index.html` e `rg-reversa/coletor/index.html`). Sem isso o navegador/leitor
  reaproveita arquivos antigos e a versão no rodapé não muda.
- A versão aparece no rodapé do dashboard e do coletor ("RG Reversa · v<n> · <data>") e é ela que
  mostra, no aparelho, se a alteração já subiu. Não dependa do `version.js` da raiz: o GitHub Pages
  desta conta também publica a branch crua, e isso apaga o carimbo do deploy.
- Depois de publicar, confira que a execução "pages build and deployment" do commit mesclado terminou com sucesso.
