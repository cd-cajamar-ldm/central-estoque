# Caderno de bases da Central

Este é o lugar oficial que diz **de onde vem cada relatório e como ele chega aos apps** da Central.

## Como funciona, em uma frase

Os relatórios saem sozinhos do Power BI nos horários agendados, caem numa pasta do SharePoint, e o app lê essa pasta.

```
Fluxos de dados (Jorran)  →  Modelo "Central de Estoque – Bases"  →  Power Automate        →  Pasta "Bases"  →  Apps da Central
(Operação CD Cajamar)        (workspace Controle de Estoque)          (roda cada receita       (SharePoint)      (leem a pasta)
                                                                       da pasta "Receitas")
```

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| [`mapa.md`](mapa.md) | A tabela-mestre: cada relatório, de onde vem, de quanto em quanto tempo atualiza e qual app usa |
| [`receitas/`](receitas/) | As "receitas": o pedido que o Power Automate faz ao Power BI. **Cada arquivo `.dax` vira um `.csv` com o mesmo nome.** Copie para a pasta `Receitas` do SharePoint |
| [`receitas-em-preparo/`](receitas-em-preparo/) | Receitas que ainda não estão prontas. **Não copie** para o SharePoint |
| [`conferencias/`](conferencias/) | Consultas para rodar no Power BI Desktop e conferir tamanho e nomes antes de ligar uma receita |
| [`passo-a-passo.md`](passo-a-passo.md) | O guia de montagem, no estilo "clique aqui, depois aqui" |

## Regras do caderno

1. **Nunca coloque senha, token ou chave de acesso em nenhum arquivo daqui.** O acesso fica guardado nas próprias ferramentas (Power BI e Power Automate), na sua conta da empresa.
2. **Só lemos os fluxos de dados de outras pessoas.** Não editamos, não adicionamos tabelas e não salvamos como "Gen2": outros relatórios dependem deles.
3. **Mudou uma receita? Atualize aqui primeiro** e depois copie para o Power Automate. Assim fica registrado quem mudou, quando e por quê.
4. Itens marcados com **⚠️ a confirmar** ainda dependem de conferir o nome exato da coluna no fluxo de dados.

## Como incluir um relatório novo

Primeiro descubra **de onde ele vem hoje**. O caminho depende disso:

| De onde vem hoje | Caminho | Fica automático? |
|---|---|---|
| **Já está em algum fluxo de dados** do Power BI | Marcar a tabela no modelo **Central de Estoque – Bases** ("Obter dados → Fluxos de dados" → **Carregar** → **Publicar → Substituir**). O Claude cria a receita `.dax` e você copia para a pasta `Receitas`. O Power Automate não muda | ✅ Sim, sem computador ligado |
| **Baixado de um sistema** (SIGE, ZBI, WMS...) e não está em fluxo de dados | Salvar o arquivo baixado **na pasta conectada**, com o número do relatório no nome. O app lê sozinho | 🟡 Meio automático: você baixa, o app importa |
| Baixado de um sistema, mas **muda pouco** (custo, estrutura de kit) | O mesmo de cima, só que **1 vez por semana ou por ciclo** já basta | 🟡 Meio automático |

Para qualquer caminho, registre o relatório no [`mapa.md`](mapa.md): de onde vem, de quanto em quanto tempo atualiza, como chega e qual app usa.

**Para o app usar o relatório**, ele precisa saber ler aquele relatório. Os que o Inventário Rotativo já sabe ler são: QRY0390, QRY0160, QRY410, QRY0843, SIGEQ278, ZBIQ0051 e Base Congelada. Um relatório novo precisa de ajuste no app.
