# Atualização automática dos relatórios em Excel

Cada relatório é um Excel (Power Query lendo o Snowflake pelo ODBC ou um fluxo de dados). Um script do próprio Windows abre cada arquivo da pasta, clica **Atualizar tudo**, salva e fecha, de tempos em tempos. Relatório novo na pasta entra sozinho na próxima rodada.

**Nenhuma senha fica nestes arquivos.** O login do Snowflake fica guardado pelo próprio Excel.

## Montar (uma vez, no computador que vai ficar ligado)

1. Crie a pasta **`Base Relatórios Automaticos/Excel`** no SharePoint e deixe-a sincronizada no computador.
2. Crie os relatórios no Excel (ex.: `QRY0390.xlsx`) e salve nessa pasta. Atualize cada um à mão **uma vez**, para o Excel guardar o login.
3. Copie `atualizar-relatorios.ps1` e `agendar.ps1` para uma pasta do computador (ex.: `Documentos\Automacao`).
4. **Teste à mão:** abra o PowerShell nessa pasta e rode:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\atualizar-relatorios.ps1 -Pasta "C:\caminho\da\pasta\Excel"
   ```
   Deve aparecer `OK    QRY0390.xlsx`.
5. **Agende:**
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\agendar.ps1 -Pasta "C:\caminho\da\pasta\Excel" -Minutos 30
   ```

## No dia a dia
- O computador precisa ficar **ligado e com você conectado** (a tela pode ficar bloqueada).
- **Não deixe os relatórios abertos**: arquivo aberto não é atualizado (aparece `ERRO ... somente leitura` no registro).
- O que aconteceu em cada rodada fica em `Excel/_registro/atualizacao.log`; o horário da última rodada boa, em `_registro/ultima-atualizacao.txt`.
- Para parar: Agendador de Tarefas → apagar **Central de Estoque - Atualizar relatórios** (ou `agendar.ps1 -Remover`).
