# Mapa das bases

Workspace do Power BI: **Operação CD Cajamar**.

## Inventário Rotativo

| Relatório | Para que serve no app | De onde vem | Atualização da origem | Como chega no app | Arquivo(s) na pasta |
|---|---|---|---|---|---|
| **QRY0390** | Estoque por endereço | Fluxo de dados **"180, 163, 390, 193 ETR"**, tabela `QRY0390` | De hora em hora | 🟢 Automático | `QRY0390_parte1.csv`, `QRY0390_parte2.csv`, `QRY0390_parte3.csv` |
| **QRY0160** | Tempo parado no endereço (pendência de movimentação) | Fluxo de dados **"410, 160, 150"**, tabela `QRY0160` ⚠️ a confirmar | 1x de madrugada, sem próxima agendada | 🟢 Automático | `QRY0160.csv` |
| **QRY410** | Perdas e ganhos (NET) | Fluxo de dados **"410, 160, 150"**, tabela `QRY410` ⚠️ a confirmar | 1x de madrugada, sem próxima agendada | 🟢 Automático | `QRY410_parte1.csv` … `QRY410_parte3.csv` |
| **Dataatt** | Data e hora da última atualização da origem | Fluxo de dados **"180, 163, 390, 193 ETR"**, tabela `Dataatt` | De hora em hora | Só conferência (não vai para a pasta) | — |
| **QRY0843** | Contagens do ciclo | Não está em fluxo de dados | — | 🟡 Manual | Como hoje |
| **SIGEQ278** | Custo dos itens | Não está em fluxo de dados | — | 🟡 Manual | Como hoje |
| **ZBIQ0051** | Item pai × componente (kits) | Não está em fluxo de dados | — | 🟡 Manual | Como hoje |
| **Base Congelada** | Locais do ciclo | Planilha feita à mão | — | 🟡 Manual | Como hoje |

### Por que alguns relatórios chegam em partes

O Power BI entrega no máximo cerca de **1 milhão de células por consulta** (linhas × colunas) e 100 mil linhas. A QRY0390 tem ~98 mil linhas com 18 colunas (~1,8 milhão de células). Por isso ela é pedida em **3 partes**, separadas pelo código do item. O app reconhece os arquivos `_parte1`, `_parte2`… da mesma pasta e **junta sozinho** antes de importar.

### Por que a QRY410 traz só o ano atual

O app guarda a NET **por ano**. Ao importar uma QRY410 só com o ano atual, os anos anteriores que já estão no app continuam lá. O arquivo precisa trazer o **ano inteiro**, não só o mês, porque o ano que vier no arquivo substitui o que está salvo.

### Por que a QRY0160 e a QRY410 podem chegar "de ontem"

O fluxo "410, 160, 150" atualiza só de madrugada. Mesmo com o despertador rodando várias vezes ao dia, essas duas só mudam uma vez por dia. Isso depende do dono do fluxo, não da Central.

### Outros fluxos do workspace (para apps futuros)

| Fluxo de dados | Tabelas vistas | Atualização |
|---|---|---|
| 180, 163, 150 – Att Constante | 180, 163, 150 | De hora em hora |
| 180, 163, 390, 193 ETR | Dataatt, QRY0180, QRY0163, QRY0390, QRY0193, QRY0166, QRY0043, QRY1001 e outras (lista não vista até o fim) | De hora em hora |
| 410, 160, 150 | 410, 160, 150 | 1x de madrugada |
