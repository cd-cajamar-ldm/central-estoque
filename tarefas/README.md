# Gerenciador de Tarefas — Central de Estoque

Quadros de tarefas da equipe, no espírito do Monday/ClickUp: cada quadro
tem grupos (seções) e tarefas, com responsável, situação, prioridade e
prazo — alternando entre visão **Quadro** (kanban, arrastar e soltar) e
visão **Tabela** (agrupada por grupo, com criação rápida de tarefa).

Cada tarefa tem datas de **início**, **fim (prazo)** e **conclusão** e um
**checklist**.

Como o módulo de Projetos, os dados **não** ficam no navegador: são
compartilhados por toda a equipe em um banco Supabase, e o acesso exige
login (e-mail e senha), com papel (admin, editor, leitor) definido no
cadastro de Pessoas — um cadastro próprio deste módulo, independente do
de Projetos, mesmo usando o mesmo login.

- Fonte: `tarefas/` (React + Vite + TypeScript + Tailwind)
- Publicado em: `gerenciador-tarefas/` (servido pelo GitHub Pages)
- Endereço: https://cd-cajamar-ldm.github.io/central-estoque/gerenciador-tarefas/

## Comandos

```bash
npm install
npm run dev            # desenvolvimento
npm run typecheck
npm run build
npm run publicar       # build + cópia para ../gerenciador-tarefas
npm run verificar:tela # build + smoke test da tela inicial (precisa de um servidor local)
```

## Banco de dados

Mesmo projeto Supabase do módulo de Projetos: **Estoque Project**
(`jfvnswafpeshyfweoadg`), região `sa-east-1`. As tabelas ficam no schema
`tarefas`, separadas dos demais módulos do mesmo banco — inclusive da
tabela `tarefas` que já existe dentro do schema `projetos` (são coisas
diferentes: aquela é a lista de afazeres de um projeto formal; esta é
um quadro de equipe de uso geral).

| Tabela | Papel |
|---|---|
| `pessoas` | quem tem acesso, com papel (`admin`, `editor`, `leitor`) |
| `quadros` | um espaço de trabalho, com nome, cor e dono |
| `grupos` | seção dentro de um quadro (a "linha" do Monday) |
| `tarefas` | o item em si: título, responsável, situação, prioridade, prazo |

As migrations ficam em `supabase/migrations/` — **ainda não foram
aplicadas ao banco**. Para o módulo funcionar, alguém com acesso ao
SQL Editor do projeto Supabase precisa rodar, nesta ordem:
`001_schema_inicial.sql`, `002_rls_e_gatilhos.sql` e
`003_status_cancelada.sql` (este sozinho: `alter type ... add value`
não pode dividir a transação com quem usa o valor novo) e
`004_datas_e_checklist.sql` (datas de início e conclusão editáveis e
checklist na tarefa; sem ela, salvar uma tarefa dá erro de coluna). A segunda
já cadastra `danilolima@lojadomecanico.com.br` como administrador do
módulo (usando a conta que já existe no mesmo projeto Supabase, criada
pelo módulo de Projetos), então o primeiro login já entra com acesso
total — sem isso, ninguém consegue se autocadastrar como admin.

### Regras de acesso

Qualquer pessoa com cadastro ativo lê todos os quadros. Administrador e
editor criam e organizam qualquer quadro, grupo ou tarefa; quem só lê
também pode mudar a situação das tarefas das quais é responsável — ser
apontado como responsável já é a permissão. Só administrador, ou quem
criou aquele quadro, renomeia ou exclui o quadro em si.

## Importações

`supabase/importacoes/` guarda scripts de carga pontual, rodados à mão
no SQL Editor depois das migrations — por exemplo, as tarefas trazidas
do ClickUp. Cada script registra o criador das tarefas pelo e-mail e
não duplica nada se rodar de novo.
