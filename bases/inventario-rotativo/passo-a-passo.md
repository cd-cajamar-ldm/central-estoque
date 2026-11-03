# Inventário Rotativo: passo a passo da atualização automática

Tempo total: cerca de **1 hora**, uma vez só. Siga na ordem.

> **Importante:** em nenhum momento você vai digitar senha em arquivo. Tudo usa a sua conta da empresa, que já está nas ferramentas.

---

## Etapa 1: criar a pasta (5 min)

1. No **SharePoint** (ou no OneDrive da empresa), crie a pasta **`Bases Inventário Rotativo`**.
2. Clique em **Sincronizar** (ou **Adicionar atalho a Meus arquivos**) para que ela apareça no Explorador de Arquivos do computador.
3. No Explorador de Arquivos, clique com o botão direito na pasta → **Sempre manter neste dispositivo**.
   - Sem isso, os arquivos ficam "só na nuvem" e o app não consegue ler.

---

## Etapa 2: criar o modelo no Power BI (20 min)

1. Abra o **Power BI Desktop** → **Arquivo → Novo**.
2. **Obter dados → Fluxos de dados do Power BI** → entre com a sua conta.
3. Abra o workspace **Operação CD Cajamar** e marque **só** estas tabelas:
   - no fluxo **"180, 163, 390, 193 ETR"**: `QRY0390` e `Dataatt`
   - no fluxo **"410, 160, 150"**: `SIGEQ410` e `QRY0160`
4. Clique em **Carregar**. Não precisa montar gráfico nenhum.
5. Salve como **`Inventário Rotativo – Bases`** e clique em **Publicar** → escolha **Operação CD Cajamar**.
6. Em **app.powerbi.com**, abra o workspace e ache o modelo semântico **Inventário Rotativo – Bases** → **⋯ → Configurações**:
   - **Credenciais da fonte de dados → Editar credenciais → OAuth2** → entre com a sua conta.
   - **Atualização agendada → Ligado**. Na licença Pro dá para escolher até **8 horários por dia**. Sugestão: 06:20, 08:20, 10:20, 12:20, 14:20, 16:20, 18:20 e 20:20.
   - Clique em **Aplicar**.

### Conferência antes de seguir

No Power BI Desktop, abra **Exibição de consulta DAX**, cole o conteúdo de [`CONTAGEM_LINHAS.dax`](CONTAGEM_LINHAS.dax) e clique em **Executar**.
- Se **alguma parte passar de 45 mil linhas**, ou se der erro, mande um print para o Claude antes de seguir.
- Se der erro com nome de coluna, mande um print das colunas da tabela (clique na setinha ▶ ao lado do nome da tabela, no painel Dados).

---

## Etapa 3: montar o "despertador" no Power Automate (40 min)

1. Entre em **make.powerautomate.com** → **Criar → Fluxo da nuvem agendado**.
2. Nome: **`Inventário Rotativo – Bases`**.
3. Repetir: **a cada 2 horas**, começando às **06:40**. Ele roda sempre 20 minutos depois da atualização do Power BI.
4. Clique em **Criar**.

### Para cada relatório da tabela abaixo, adicione 3 ações (em sequência)

| Ordem | Receita (copiar daqui) | Nome do arquivo |
|---|---|---|
| 1 | [`QRY0390_parte1.dax`](QRY0390_parte1.dax) | `QRY0390_parte1.csv` |
| 2 | [`QRY0390_parte2.dax`](QRY0390_parte2.dax) | `QRY0390_parte2.csv` |
| 3 | [`QRY0390_parte3.dax`](QRY0390_parte3.dax) | `QRY0390_parte3.csv` |
| 4 | [`QRY0160.dax`](QRY0160.dax) | `QRY0160.csv` |
| 5 | [`SIGEQ410_parte1.dax`](SIGEQ410_parte1.dax) | `SIGEQ410_parte1.csv` |
| 6 | [`SIGEQ410_parte2.dax`](SIGEQ410_parte2.dax) | `SIGEQ410_parte2.csv` |
| 7 | [`SIGEQ410_parte3.dax`](SIGEQ410_parte3.dax) | `SIGEQ410_parte3.csv` |

**Ação A: pedir o relatório ao Power BI**
1. **+ Nova etapa** → procure **Power BI** → **Executar uma consulta em um conjunto de dados**.
2. Espaço de trabalho: **Operação CD Cajamar**.
3. Conjunto de dados: **Inventário Rotativo – Bases**.
4. Texto da consulta: **cole todo o conteúdo** do arquivo `.dax` da tabela acima.

**Ação B: transformar em planilha CSV**
1. **+ Nova etapa** → **Operação de Dados** → **Criar tabela CSV**.
2. De: escolha **Primeiras linhas da tabela** (da Ação A logo acima).
3. Colunas: **Automático**.

**Ação C: salvar na pasta**
1. **+ Nova etapa** → **SharePoint** → **Criar arquivo**.
2. Endereço do site: o site onde está a pasta da Etapa 1.
3. Caminho da pasta: **`Bases Inventário Rotativo`**.
4. Nome do arquivo: o da tabela acima (exatamente igual, com `_parte1` etc.).
5. Conteúdo do arquivo: **Saída** (da Ação B logo acima).

> Dica: depois de montar as 3 ações da primeira linha, use **⋯ → Copiar para minha área de transferência** e cole para as outras, trocando só a receita e o nome do arquivo.

### Aviso por e-mail quando der erro

1. No fim do fluxo, **+ Nova etapa** → **Office 365 Outlook → Enviar um email (V2)**.
2. Para: o seu e-mail. Assunto: **`Falhou a atualização do Inventário Rotativo`**.
3. Nessa ação, **⋯ → Configurar execução após** → marque **falhou** e **atingiu o tempo limite**, desmarque **foi bem-sucedido**.

5. Clique em **Salvar** e depois em **Testar → Manualmente**. Confira se os 7 arquivos apareceram na pasta.

---

## Etapa 4: ligar o app na pasta (2 min, uma vez só)

1. Abra o **Inventário Rotativo** no **Chrome ou Edge** → aba **Importação**.
2. No quadro **Pasta conectada**, clique em **Conectar pasta** → escolha **Bases Inventário Rotativo** → **Permitir**.
3. O app lê a pasta e importa sozinho. No topo do quadro aparece **"Dados de DD/MM HH:MM"**: é a hora do arquivo mais antigo entre os automáticos.

**No dia a dia:** ao abrir o app, se ele pedir, clique em **Permitir acesso** (o navegador exige esse clique por segurança). Depois disso, é só usar. Para puxar o que chegou depois, clique em **Buscar novidades**.

Os relatórios manuais (**QRY0843, SIGEQ278, ZBIQ0051 e Base Congelada**) podem ficar na mesma pasta: o app lê tudo junto.

---

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| E-mail "Falhou a atualização" | Abra o fluxo no Power Automate → **Histórico de execuções** → clique na que falhou e mande um print da etapa vermelha para o Claude |
| No app: "colunas obrigatórias não encontradas" | O nome de alguma coluna mudou no fluxo de dados. Mande o print da mensagem para o Claude ajustar a receita |
| No app: "Dados de" mostra uma hora antiga | Confira se o Power Automate rodou e se a pasta está como **Sempre manter neste dispositivo** |
| QRY0160 / QRY410 não mudam durante o dia | Normal: o fluxo de dados delas só atualiza de madrugada |
