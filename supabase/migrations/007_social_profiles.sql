-- ============================================================================
-- GMT Takip — Migration 007  (Bağlantılar ve Panolar · Aşama 1a)
-- Ekler: public.profiles  (başka kullanıcılara gösterilebilecek minimal profil)
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
--
-- NEDEN AYRI BİR TABLO: Devamsızlık tabloları (semesters, courses,
-- absence_records) bu dosyada HİÇ değiştirilmiyor; sosyal özellikler onlara
-- erişmiyor. Başkalarına gösterilecek bilgi yalnızca burada durur.
--
-- E-POSTA BURADA YOK: E-posta zaten auth.users'ta ve istemci başka bir
-- kullanıcının auth.users satırını okuyamaz. Onu buraya kopyalamak yalnızca
-- sızma yüzeyi yaratırdı; bu yüzden ayrı bir "profile_private" tablosuna da
-- gerek kalmadı.
-- ============================================================================
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  department   text check (department is null or char_length(department) <= 80),
  -- 0 = hazırlık, 1..6 = sınıf (derslerdeki "sınıf" etiketiyle aynı ölçek)
  class_year   smallint check (class_year is null or class_year between 0 and 6),
  -- Yalnızca Google'ın fotoğraf sunucusu kabul edilir: aksi halde biri
  -- profil fotoğrafı yerine, bakan herkesin IP'sini toplayan bir adres
  -- koyabilirdi.
  avatar_url   text check (
    avatar_url is null
    or (char_length(avatar_url) <= 500 and avatar_url ~ '^https://[a-z0-9-]+\.googleusercontent\.com/')
  ),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Okuma: şimdilik YALNIZCA kendisi. Bağlantılar (Aşama 1c) ve ortak pano
-- üyeleri (Aşama 2a) sonraki migration'larda bu kurala eklenecek. Kimse
-- tabloyu tarayamaz; kodla kişi bulma ayrı bir sunucu fonksiyonu üzerinden
-- yapılacak (Aşama 1b).
drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Silme politikası yok: profil, hesap silinince (auth.users) kendiliğinden
-- gider. Misafir hiçbir zaman buraya yazamaz (auth.uid() boş).

-- updated_at'i sunucu tutar; istemcinin saatine güvenilmez.
create or replace function public.social_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.social_touch_updated_at();
