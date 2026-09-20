-- ============================================================================
-- GMT Takip — Migration 006
-- Ekler: public.user_prefs  (tema ve dil tercihi)
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
--
-- NEDEN: Tema ve dil şimdiye kadar yalnızca cihazda duruyordu; yeni telefonda
-- ya da profil sıfırlandıktan sonra varsayılana dönüyordu. Artık hesapla
-- birlikte geliyor. Bildirim izni burada TUTULMAZ: o telefonun kendi izni,
-- taşınamaz.
-- ============================================================================
create table if not exists public.user_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  theme       text,
  lang        text,
  updated_at  timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

drop policy if exists "own prefs" on public.user_prefs;
create policy "own prefs" on public.user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
