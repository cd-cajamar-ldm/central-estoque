# Gestão de acesso — schema compartilhado

Lista única de pessoas e permissões, compartilhada entre todos os apps da
Oficina LDM — em vez de cada módulo duplicar o próprio cadastro (como
`tarefas.pessoas` e `projetos.pessoas` fazem hoje).

Aplicada no mesmo projeto Supabase já usado por Tarefas e Projetos
("Estoque Project", `jfvnswafpeshyfweoadg`), em schema próprio (`acessos`)
para não se misturar com os outros módulos.

## Como aplicar

Este repositório não tem CI que aplique migrações sozinho (mesma situação de
`tarefas/supabase/migrations/` e `projetos/supabase/migrations/`). Rode o
arquivo em `migrations/` manualmente, na ordem, pelo SQL Editor do painel do
Supabase ou pelo `supabase db push` do Supabase CLI, apontando pro projeto
`jfvnswafpeshyfweoadg`.

## O que fica aqui

- `acessos.pessoas` — nome, e-mail, situação (ativo/inativo), papel
  (admin/colaborador). `user_id` só é preenchido depois do primeiro login,
  pelo e-mail (mesmo padrão de Projetos).
- `acessos.permissoes` — qual `app_key` (mesma chave usada no catálogo do
  hub, ex. `'multiplos'`, `'tarefas'`) cada pessoa pode acessar. Uma
  autorização num app não libera os outros.
- `public.ldm_pode_acessar(app_key)` — função que qualquer app chama (via
  `supabase.rpc('ldm_pode_acessar', { p_app_key: '...' })`) pra saber se a
  pessoa logada pode entrar ali. É a única coisa que um app protegido
  precisa chamar além do login — toda a regra fica no banco (RLS), não no
  navegador.
