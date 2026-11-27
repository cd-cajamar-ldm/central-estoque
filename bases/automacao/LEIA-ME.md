# Atualização automática dos relatórios em Excel

Cada relatório é um Excel (Power Query lendo o Snowflake pelo ODBC ou um fluxo de dados). Um script do próprio Windows abre cada arquivo da pasta, clica **Atualizar tudo**, salva e fecha, de tempos em tempos. Relatório novo na pasta entra sozinho na próxima rodada.

**Nenhuma senha fica nestes arquivos.** O login do Snowflake fica guardado pelo próprio Excel.

## Montar (uma vez, no computador que vai ficar ligado)

1. Os relatórios em Excel ficam na pasta **Bases** sincronizada (`CD CAJAMAR - CONTROLE DE ESTOQUE - Bases`). Atualize cada um à mão **uma vez**, para o Excel guardar o login.
2. Dentro da **Bases**, coloque a pasta **`_automacao`** com estes arquivos (o `.zip` já vem com ela: botão direito → **Extrair tudo** → escolher a pasta Bases).
3. **Feche todos os Excel** e dê dois cliques em **`1 - ATUALIZAR AGORA.cmd`**. Deve aparecer `OK` para cada arquivo.
4. Deu certo? Dois cliques em **`2 - LIGAR AUTOMATICO.cmd`**. Pronto: a cada 30 minutos, sozinho.

Se o Windows avisar "O Windows protegeu o computador": **Mais informações → Executar assim mesmo**.

## No dia a dia
- O computador precisa ficar **ligado e com você conectado** (a tela pode ficar bloqueada).
- **Não deixe os relatórios abertos**: arquivo aberto não é atualizado (aparece `ERRO ... somente leitura` no registro).
- O que aconteceu em cada rodada fica em `Bases/_registro/atualizacao.log`; o horário da última rodada boa, em `_registro/ultima-atualizacao.txt`.
- Para parar: Agendador de Tarefas → apagar **Central de Estoque - Atualizar relatórios** (ou dois cliques em `3 - DESLIGAR AUTOMATICO.cmd`).
