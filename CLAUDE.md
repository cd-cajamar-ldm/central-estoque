# Instruções para o Claude neste repositório

## Como responder
- Sempre termine com um **resumo curto** das mudanças: poucas linhas, em tópicos, linguagem simples (sem detalhes técnicos).
- Diga em uma linha o que a pessoa precisa fazer (ex.: atualizar com Ctrl+F5, importar um arquivo).
- Evite textos longos: o objetivo é entender as mudanças sem ter que ler muito.

## Todo app novo precisa de controle de acesso
- Todo app criado neste repositório deve nascer com: tela de login (copiar `multiplos-descasados/js/acesso.js` e `css/acesso.css`), `app_key` próprio no catálogo do hub (`index.html`) e liberação por pessoa em Configurações, com nível **Pode editar / Só visualizar** (`supabase-acessos/`).
- Dados compartilhados entre pessoas ficam no Supabase (tabela própria, com RLS usando `acessos.pode_acessar('<app_key>')` para ler e `acessos.pode_editar('<app_key>')` para gravar) — nunca só no navegador. Modelo: `multiplos-descasados/js/nuvem.js` e `supabase-acessos/migrations/004`–`006`.
- No nível "visualizar", esconder Importação/Configurações e não gravar nada (`window.LDM_SOMENTE_LEITURA`).
