-- ---------------------------------------------------------------
-- Funcoes de apoio as policies.
-- SECURITY DEFINER de proposito: elas leem tarefas.pessoas, que tem
-- RLS. Sem isso a policy de pessoas chamaria a si mesma em recursao.
-- ---------------------------------------------------------------

-- Qualquer pessoa consegue pedir um link magico ao Supabase. Se "estar
-- autenticado" bastasse para ler, um e-mail de fora veria os quadros
-- inteiros. Acesso exige cadastro previo feito por um administrador; o
-- login apenas se liga a esse cadastro.
create or replace function tarefas.tem_acesso()
returns boolean language sql stable security definer set search_path = tarefas, pg_temp
as $$ select exists (select 1 from tarefas.pessoas p where p.user_id = auth.uid() and p.ativo); $$;

create or replace function tarefas.papel_atual()
returns tarefas.papel language sql stable security definer set search_path = tarefas, pg_temp
as $$
  select coalesce(
    (select p.papel from tarefas.pessoas p where p.user_id = auth.uid() and p.ativo limit 1),
    'leitor'::tarefas.papel
  );
$$;

create or replace function tarefas.eh_admin()
returns boolean language sql stable security definer set search_path = tarefas, pg_temp
as $$ select tarefas.tem_acesso() and tarefas.papel_atual() = 'admin'::tarefas.papel; $$;

-- Criar quadro, grupo ou tarefa: admin ou editor. Diferente de
-- projetos, aqui nao ha "dono do quadro" controlando quem mexe em
-- grupo e tarefa — e um quadro de equipe, qualquer editor organiza.
create or replace function tarefas.pode_criar()
returns boolean language sql stable security definer set search_path = tarefas, pg_temp
as $$ select tarefas.tem_acesso() and tarefas.papel_atual() in ('admin'::tarefas.papel, 'editor'::tarefas.papel); $$;

-- So renomear/arquivar/excluir o quadro em si fica mais fechado: admin,
-- ou quem criou aquele quadro.
create or replace function tarefas.pode_editar_quadro(p_quadro uuid)
returns boolean language sql stable security definer set search_path = tarefas, pg_temp
as $$
  select tarefas.eh_admin() or exists (
    select 1 from tarefas.quadros q where q.id = p_quadro and q.criado_por = auth.uid()
  );
$$;

create or replace function tarefas.marcar_atualizacao()
returns trigger language plpgsql set search_path = tarefas, pg_temp
as $$ begin new.atualizado_em := now(); return new; end; $$;

create trigger pessoas_atualizado_em before update on tarefas.pessoas
  for each row execute function tarefas.marcar_atualizacao();
create trigger quadros_atualizado_em before update on tarefas.quadros
  for each row execute function tarefas.marcar_atualizacao();
create trigger tarefas_atualizado_em before update on tarefas.tarefas
  for each row execute function tarefas.marcar_atualizacao();

-- Registra (e limpa) a data de conclusao sozinho: ninguem digita essa
-- data, ela segue a situacao. Assim o cartao mostra "concluida em" sem
-- exigir mais um campo no formulario.
create or replace function tarefas.marcar_conclusao()
returns trigger language plpgsql set search_path = tarefas, pg_temp
as $$
begin
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    new.concluida_em := current_date;
  elsif new.status is distinct from 'concluida' and old.status = 'concluida' then
    new.concluida_em := null;
  end if;
  return new;
end;
$$;

create trigger tarefas_marcar_conclusao before update on tarefas.tarefas
  for each row execute function tarefas.marcar_conclusao();

-- Um usuario pode corrigir o proprio cadastro, mas nao se promover.
create or replace function tarefas.impede_autopromocao()
returns trigger language plpgsql security definer set search_path = tarefas, pg_temp
as $$
begin
  if (new.papel is distinct from old.papel
      or new.ativo is distinct from old.ativo
      or new.user_id is distinct from old.user_id)
     and auth.uid() is not null
     and not tarefas.eh_admin() then
    raise exception 'somente um administrador pode alterar papel, vinculo ou situacao de acesso';
  end if;
  return new;
end;
$$;

create trigger pessoas_papel_protegido before update on tarefas.pessoas
  for each row execute function tarefas.impede_autopromocao();

-- Primeiro acesso: liga o login ao cadastro feito pelo administrador.
-- O primeiro usuario do modulo nasce admin, senao nao haveria ninguem
-- para cadastrar os demais. Dispara para QUALQUER cadastro novo no
-- projeto Supabase (o mesmo auth.users de projetos e dos demais
-- modulos) — inofensivo para quem nunca abriu este modulo, porque so
-- mexe em tarefas.pessoas.
create or replace function tarefas.vincular_novo_usuario()
returns trigger language plpgsql security definer set search_path = tarefas, pg_temp
as $$
declare
  v_email text := lower(new.email);
  v_existe boolean;
begin
  update tarefas.pessoas set user_id = new.id
   where lower(email) = v_email and user_id is null;

  if not found then
    select exists (select 1 from tarefas.pessoas where user_id is not null) into v_existe;
    if not v_existe then
      insert into tarefas.pessoas (user_id, nome, email, papel)
      values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(v_email, '@', 1)), v_email, 'admin');
    end if;
  end if;

  return new;
end;
$$;

create trigger tarefas_vincular_novo_usuario after insert on auth.users
  for each row execute function tarefas.vincular_novo_usuario();

-- ---------------------------------------------------------------
-- RLS: leitura para quem tem cadastro ativo, escrita conforme papel.
-- ---------------------------------------------------------------
alter table tarefas.pessoas enable row level security;
alter table tarefas.quadros enable row level security;
alter table tarefas.grupos enable row level security;
alter table tarefas.tarefas enable row level security;

-- A propria linha e sempre visivel: e como a tela sabe dizer "seu
-- e-mail ainda nao tem acesso" em vez de mostrar um vazio sem motivo.
create policy pessoas_leitura on tarefas.pessoas
  for select to authenticated using (tarefas.tem_acesso() or user_id = auth.uid());
create policy pessoas_insercao on tarefas.pessoas
  for insert to authenticated with check (tarefas.eh_admin());
create policy pessoas_alteracao on tarefas.pessoas
  for update to authenticated
  using (tarefas.eh_admin() or user_id = auth.uid())
  with check (tarefas.eh_admin() or user_id = auth.uid());
create policy pessoas_exclusao on tarefas.pessoas
  for delete to authenticated using (tarefas.eh_admin());

create policy quadros_leitura on tarefas.quadros
  for select to authenticated using (tarefas.tem_acesso());
create policy quadros_insercao on tarefas.quadros
  for insert to authenticated with check (tarefas.pode_criar());
create policy quadros_alteracao on tarefas.quadros
  for update to authenticated
  using (tarefas.pode_editar_quadro(id)) with check (tarefas.pode_editar_quadro(id));
create policy quadros_exclusao on tarefas.quadros
  for delete to authenticated using (tarefas.pode_editar_quadro(id));

create policy grupos_leitura on tarefas.grupos
  for select to authenticated using (tarefas.tem_acesso());
create policy grupos_escrita on tarefas.grupos
  for all to authenticated using (tarefas.pode_criar()) with check (tarefas.pode_criar());

create policy tarefas_leitura on tarefas.tarefas
  for select to authenticated using (tarefas.tem_acesso());
create policy tarefas_escrita on tarefas.tarefas
  for all to authenticated using (tarefas.pode_criar()) with check (tarefas.pode_criar());
-- Quem e o responsavel por uma tarefa move/atualiza ela mesmo sendo
-- leitor — ser apontado como responsavel ja e a permissao.
create policy tarefas_responsavel_atualiza on tarefas.tarefas
  for update to authenticated
  using (exists (select 1 from tarefas.pessoas pe where pe.id = tarefas.responsavel_id and pe.user_id = auth.uid() and pe.ativo))
  with check (exists (select 1 from tarefas.pessoas pe where pe.id = tarefas.responsavel_id and pe.user_id = auth.uid() and pe.ativo));

-- ---------------------------------------------------------------
-- Primeiro administrador: o login do dono do modulo ja existe em
-- auth.users (criado quando o modulo de Projetos foi aberto, no mesmo
-- projeto Supabase) — o gatilho de primeiro acesso acima so dispara em
-- CADASTRO novo, nao em login, entao nao alcanca quem ja tem conta.
-- Sem esta linha, a primeira entrada aqui cairia em "acesso ainda nao
-- liberado" sem ninguem para se autocadastrar como admin.
-- ---------------------------------------------------------------
insert into tarefas.pessoas (user_id, nome, email, papel)
select u.id, coalesce(u.raw_user_meta_data->>'name', 'Danilo Lima'), lower(u.email), 'admin'
from auth.users u
where lower(u.email) = 'danilolima@lojadomecanico.com.br'
on conflict (email) do nothing;
