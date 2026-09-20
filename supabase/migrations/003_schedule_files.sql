-- ============================================================================
-- GMT Takip — Migration 003
-- Ekler:  public.schedule_files   (ders programı dosyalarının bilgileri)
--         storage bucket "schedules" (dosyaların kendisi)
--
-- NASIL ÇALIŞTIRILIR
--   Supabase paneli > SQL Editor > New query > bu dosyanın TAMAMINI yapıştır
--   > Run.  Bir kere çalıştırmak yeterli, tekrar çalıştırmak zararsız.
--
-- NEDEN GEREKLİ
--   Ders programı fotoğrafları ve Excel dosyaları şimdiye kadar yalnızca
--   telefonda duruyordu; telefon değişince kayboluyordu. Dosyanın kendisi
--   Storage'a, adı/türü/silinme durumu bu tabloya yazılır.
--
-- GİZLİLİK
--   Bucket herkese kapalı (public = false) ve politikalar gereği her kullanıcı
--   yalnızca KENDİ klasörüne (schedules/<kullanıcı-id>/...) erişebilir.
-- ============================================================================

create table if not exists public.schedule_files (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null default 'image',   -- 'image' | 'sheet'
  name         text,                            -- tablolarda dosya adı
  width        integer not null default 0,
  height       integer not null default 0,
  storage_path text not null,                   -- schedules bucket içindeki yol
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  client_id    text
);

create index if not exists idx_schedule_files_user on public.schedule_files (user_id);

alter table public.schedule_files enable row level security;

drop policy if exists "own schedule files" on public.schedule_files;
create policy "own schedule files" on public.schedule_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- Dosyaların kendisi: Storage bucket ------------------------------------
insert into storage.buckets (id, name, public)
values ('schedules', 'schedules', false)
on conflict (id) do nothing;

-- Her kullanıcı yalnızca kendi klasöründeki dosyalara erişir.
-- Yol düzeni: schedules/<auth.uid()>/<dosya-id>
drop policy if exists "own schedule objects read" on storage.objects;
create policy "own schedule objects read" on storage.objects
  for select using (
    bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own schedule objects insert" on storage.objects;
create policy "own schedule objects insert" on storage.objects
  for insert with check (
    bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own schedule objects update" on storage.objects;
create policy "own schedule objects update" on storage.objects
  for update using (
    bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own schedule objects delete" on storage.objects;
create policy "own schedule objects delete" on storage.objects
  for delete using (
    bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text
  );
