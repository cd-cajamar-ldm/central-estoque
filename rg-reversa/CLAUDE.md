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
- **QRY0110 · RG - Movimentos** (importação, soma sem duplicar; grupo `mov` guardado em `rg_dados`): alimenta a aba
  **Produtividade** (movimentações por dia e por pessoa, RGs/hora trabalhada, fila da triagem, tempo até armazenar, retrabalho,
  locais mais movimentados e conferência com o coletor via `rg_movimentacoes`) e dá a data exata de chegada do RG ao local
  para o "Tempo em misto" do Dashboard. A "triagem" é a origem mais frequente das movimentações.
- **Valoração** (SIGEQ278 · Preço de custo, grupo `preco`, substitui a anterior): valor = quantidade × preço de custo unitário.
  Item comum: custo da SIGEQ278. Componente de kit (ZBIQ0051): `in_interface` = N vale R$ 0 (de propósito); = S usa o custo do
  item pai (`item_vol_multiplo`) e, se o pai não tiver preço, o do próprio componente. Sem preço vale R$ 0 e entra no
  diagnóstico "Itens sem preço" (exceto os N). Sem a SIGEQ278 o app volta a usar o PRECO da QRY0100. A ZBIQ0051 precisa ter a
  coluna `in_interface`; sem ela o app avisa e trata o item como comum. Código: `mkValor()` em `js/app.js`.
- **Ociosidade e filtros** (aba Produtividade): período (hoje, ontem, 7/30 dias, mês, mês passado, ano, tudo, de–até), agrupar por
  dia/semana/mês/ano e comparar o dia com o dia anterior, a média do mesmo dia da semana (30 d) ou o melhor dia. "Horas sem
  produção" usa o horário de trabalho `WORK_H` (8h–12h e 14h–18h); horas depois do último registro importado não contam como
  paradas. A hora de criação do RG vem da QRY0100 (campo `h`; o minuto do arquivo é defeituoso) — RGs importados antes dessa
  versão não têm hora e pedem nova importação. Dashboard "Operadores": se a QRY0100 vier sem operador, mostra quem moveu (QRY0110).
