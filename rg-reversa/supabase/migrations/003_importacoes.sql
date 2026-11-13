-- RG Reversa — guarda no servidor a ÚLTIMA importação de cada relatório (QRY0100, QRY0390, ZBIQ0051).
-- Assim qualquer computador que abrir o app enxerga os mesmos dados, sem precisar importar de novo.
-- Os arquivos (rgs, est, mult e meta, em JSON compactado) ficam num balde privado do Storage;
-- só quem tem a permissão 'rgreversa' lê e grava.
insert into storage.buckets (id, name, public, file_size_limit)
values ('rg-reversa', 'rg-reversa', false, 52428800)
on conflict (id) do nothing;

drop policy if exists rg_reversa_obj_select on storage.objects;
create policy rg_reversa_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'rg-reversa' and public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_reversa_obj_insert on storage.objects;
create policy rg_reversa_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'rg-reversa' and public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_reversa_obj_update on storage.objects;
create policy rg_reversa_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'rg-reversa' and public.ldm_pode_acessar('rgreversa'))
  with check (bucket_id = 'rg-reversa' and public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_reversa_obj_delete on storage.objects;
create policy rg_reversa_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'rg-reversa' and public.ldm_pode_acessar('rgreversa'));
