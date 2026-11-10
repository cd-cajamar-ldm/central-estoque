-- Faltou no 001: criar o schema e as tabelas não basta, o Postgres nega
-- acesso por padrão até alguém conceder o privilégio no próprio schema e
-- nas tabelas (RLS só entra em cena DEPOIS que esse primeiro portão abre).
-- Mesmo padrão já usado em tarefas/supabase/migrations/001_schema_inicial.sql
-- e projetos/supabase/migrations/001_schema_inicial.sql.
grant usage on schema acessos to authenticated;
grant select, insert, update, delete on all tables in schema acessos to authenticated;
alter default privileges in schema acessos grant select, insert, update, delete on tables to authenticated;
