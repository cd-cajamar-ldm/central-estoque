# Passo a passo da atualização automática da Central

Tempo total: cerca de **1 hora**, uma vez só. Siga na ordem.

> **Importante:** em nenhum momento você vai digitar senha em arquivo. Tudo usa a sua conta da empresa, que já está nas ferramentas.

## A ideia, e por que ela não precisa ser refeita depois

```
Fluxos de dados             Modelo no Power BI              Power Automate                 SharePoint
(workspace Operação    →    "Central de Estoque – Bases"  →  lê CADA receita da pasta  →   pasta "Bases"
 CD Cajamar, do Jorran)     (workspace Controle de Estoque)  "Receitas" e salva um CSV       (o app lê daqui)
```

- **Um modelo só para a Central inteira**, não um por app. Relatório novo é só marcar mais uma tabela.
- **Um despertador só, que lê a pasta "Receitas".** Para incluir um relatório novo, basta colocar mais um arquivo `.dax` nessa pasta. **O Power Automate não precisa ser mexido.**
- Os fluxos de dados continuam no workspace **Operação CD Cajamar** (só lemos de lá). O **seu** modelo fica no workspace **Controle de Estoque**.

---

## Etapa 1: criar as pastas no SharePoint (5 min)

1. No **SharePoint** (ou no OneDrive da empresa), crie a pasta **`Central de Estoque`** e, dentro dela, duas pastas:
   - **`Receitas`**: onde ficam as receitas (arquivos `.dax`);
   - **`Bases`**: onde o Power Automate salva os relatórios prontos.
2. Copie para a pasta **`Receitas`** os arquivos da pasta [`receitas/`](receitas/) da Central:
   `QRY0390_parte1.dax`, `QRY0390_parte2.dax`, `QRY0390_parte3.dax`, `QRY0160_parte1.dax`, `QRY0160_parte2.dax` e `QRY0160_parte3.dax`.
3. Na pasta **`Bases`**, clique em **Sincronizar** (ou **Adicionar atalho a Meus arquivos**) para que ela apareça no Explorador de Arquivos do computador.
4. No Explorador de Arquivos, clique com o botão direito na pasta **`Bases`** → **Sempre manter neste dispositivo**.
   - Sem isso, os arquivos ficam "só na nuvem" e o app não consegue ler.

O **nome do arquivo de receita** decide o nome do relatório salvo: `QRY0390_parte1.dax` vira `QRY0390_parte1.csv`.

---

## Etapa 2: o modelo no Power BI (20 min)

1. Abra o **Power BI Desktop** → **Arquivo → Novo** (ou abra o arquivo que você já começou).
2. **Obter dados → Fluxos de dados** → entre com a sua conta.
3. Abra o workspace **Operação CD Cajamar** e marque estas tabelas:
   - no fluxo **"180, 163, 390, 193 ETR"**: `QRY0390`
   - no fluxo **"410, 160, 150"**: `QRY0160` e `SIGEQ410`
4. Clique em **Carregar**.
5. **Filtre a SIGEQ410** em **Transformar dados**: `Dt.Mov.` → **Filtros de Data → Ano → Este ano**; `FIlial` → só a do CD Cajamar; deixe só as 15 colunas que o app usa (veja o [mapa](mapa.md)) → **Fechar e Aplicar**.
6. Salve como **`Central de Estoque – Bases`**.
7. Clique em **Publicar** → escolha o workspace **Controle de Estoque**.
   - Se o arquivo já foi publicado antes em **Operação CD Cajamar**, lá no site apague a cópia antiga (o relatório e o modelo semântico), para não ficarem duas atualizando.
8. Em **app.powerbi.com → Workspaces → Controle de Estoque**, ache o **modelo semântico** (ícone de tabelinha) **Central de Estoque – Bases** → **⋯ → Configurações**:
   - **Credenciais da fonte de dados → Editar credenciais → OAuth2** → entre com a sua conta.
   - **Atualização agendada → Ligado**, fuso **Brasília**, **Diariamente**. Na licença Pro dá para escolher até **8 horários**. Sugestão: 06:20, 08:20, 10:20, 12:20, 14:20, 16:20, 18:20 e 20:20.
   - Clique em **Aplicar**.

**Para incluir uma tabela depois:** abra o arquivo, **Obter dados → Fluxos de dados**, marque a tabela nova, **Carregar**, **Salvar**, **Publicar → Controle de Estoque → Substituir**. Não mude o nome do arquivo.

### Conferência antes de seguir

Na **Exibição de consulta DAX**, cole o conteúdo de [`conferencias/CONTAGEM_LINHAS.dax`](conferencias/CONTAGEM_LINHAS.dax) e clique em **Executar**. Cada parte precisa ficar **abaixo de 45 mil linhas**. Se passar, ou se der erro, mande um print para o Claude.

---

## Etapa 3: o "despertador" no Power Automate (30 min, uma vez só)

1. Entre em **make.powerautomate.com** → **Criar → Fluxo da nuvem agendado**.
2. Nome: **`Central de Estoque – Bases`**.
3. Repetir: **a cada 2 horas**, começando às **06:40**. Ele roda 20 minutos depois de cada atualização do Power BI.
4. Clique em **Criar**.

### Ação 1: listar as receitas
1. **+ Nova etapa** → **SharePoint** → **Listar pasta**.
2. Endereço do site: o site da pasta da Etapa 1.
3. Identificador de arquivo: escolha a pasta **`Central de Estoque/Receitas`**.

### Ação 2: repetir para cada receita
1. **+ Nova etapa** → **Controle** → **Aplicar a cada**.
2. Em "Selecionar uma saída das etapas anteriores": **Corpo** (da Ação 1).
3. Nos **⋯ → Configurações** dessa ação, ligue **Controle de simultaneidade** e coloque **1**. Assim as receitas rodam uma de cada vez.

**Dentro do "Aplicar a cada"**, adicione 4 ações, nesta ordem:

**2a. Ler a receita**
- **SharePoint → Obter conteúdo do arquivo**.
- Endereço do site: o mesmo.
- Identificador de arquivo: **Id** (da Ação 1).

**2b. Pedir o relatório ao Power BI**
- **Power BI → Executar uma consulta em um conjunto de dados**.
- Espaço de trabalho: **Controle de Estoque**.
- Conjunto de dados: **Central de Estoque – Bases**.
- Texto da consulta: clique em **Expressão** (o **fx**) e cole:
  ```
  base64ToString(body('Obter_conteúdo_do_arquivo')?['$content'])
  ```

**2c. Transformar em CSV**
- **Operação de Dados → Criar tabela CSV**.
- De: **Primeiras linhas da tabela** (da ação 2b).
- Colunas: **Automático**.

**2d. Salvar na pasta Bases**
- **SharePoint → Criar arquivo**.
- Endereço do site: o mesmo.
- Caminho da pasta: **`Central de Estoque/Bases`**.
- Nome do arquivo: clique em **Expressão (fx)** e cole:
  ```
  replace(items('Aplicar_a_cada')?['Name'], '.dax', '.csv')
  ```
- Conteúdo do arquivo: **Saída** (da ação 2c).

> Se o Power Automate deu outro nome às ações (por exemplo "Obter conteúdo do arquivo 2" ou "Apply to each"), troque nas expressões: espaço vira `_`. Na dúvida, mande um print para o Claude.

### Ação 3: aviso por e-mail quando der erro
1. Fora do "Aplicar a cada", **+ Nova etapa** → **Office 365 Outlook → Enviar um email (V2)**.
2. Para: o seu e-mail. Assunto: **`Falhou a atualização das bases da Central`**.
3. Nessa ação, **⋯ → Configurar execução após** → marque **falhou** e **atingiu o tempo limite** e desmarque **foi bem-sucedido**.

Clique em **Salvar** e depois em **Testar → Manualmente**. Confira se apareceu **um `.csv` para cada `.dax`** na pasta **Bases**.

### Para incluir um relatório novo depois
1. O Claude cria a receita (`.dax`) na Central.
2. Você copia o arquivo para a pasta **`Receitas`** do SharePoint.
3. Pronto: no próximo horário o Power Automate já gera o CSV. **Nada mais muda.**

Para tirar um relatório, apague a receita da pasta **`Receitas`** (e o CSV antigo da pasta **`Bases`**).

---

## Etapa 4: ligar o app na pasta (2 min, uma vez só)

1. Abra o **Inventário Rotativo** no **Chrome ou Edge** → aba **Importação**.
2. No quadro **Pasta conectada**, clique em **Conectar pasta** → escolha **`Bases`** → **Permitir**.
3. O app lê a pasta e importa sozinho. No topo do quadro aparece **"Dados de DD/MM HH:MM"**: é a hora do arquivo mais antigo entre os automáticos.

**No dia a dia:** ao abrir o app, se ele pedir, clique em **Permitir acesso** (o navegador exige esse clique por segurança). Para puxar o que chegou depois, clique em **Buscar novidades**.

Os relatórios manuais (**QRY410 até ela ficar automática, QRY0843, SIGEQ278, ZBIQ0051 e Base Congelada**) podem ser salvos na mesma pasta **`Bases`**: o app lê tudo junto.

---

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| E-mail "Falhou a atualização" | Abra o fluxo no Power Automate → **Histórico de execuções** → clique na que falhou e mande um print da etapa vermelha para o Claude |
| Erro na ação 2b falando de `base64` | A receita já veio como texto: troque a expressão por `body('Obter_conteúdo_do_arquivo')` |
| No app: "colunas obrigatórias não encontradas" | O nome de alguma coluna mudou no fluxo de dados. Mande o print da mensagem para o Claude ajustar a receita |
| No app: "Dados de" mostra uma hora antiga | Confira se o Power Automate rodou e se a pasta está como **Sempre manter neste dispositivo** |
| QRY0160 / QRY410 não mudam durante o dia | Normal: o fluxo de dados delas só atualiza de madrugada |
