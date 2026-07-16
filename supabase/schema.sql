-- ============================================================================
-- GMT Devamsızlık — Supabase şeması + Row Level Security
-- Supabase projesi > SQL Editor içine yapıştırıp çalıştırın.
-- Her kullanıcı YALNIZCA kendi satırlarını görebilir/yazabilir.
-- ============================================================================

-- Dönemler / sömestrler
create table if not exists public.semesters (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  client_id   text
);

-- Dersler
create table if not exists public.courses (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  total_hours  numeric not null,
  semester_id  text,
  archived     boolean not null default false,
  -- İsteğe bağlı: kaçıncı sınıfın dersi. 0 = Hazırlık, 1..6 = sınıf,
  -- null = belirtilmemiş. Nullable — eski satırlar aynen çalışmaya devam eder.
  grade        integer,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  client_id    text
);

-- Devamsızlık kayıtları
create table if not exists public.absence_records (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  course_id   text not null,
  date        date not null,
  hours       numeric not null,
  -- İsteğe bağlı kısa açıklama (o gün neden gelinmedi). null = yok.
  note        text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  client_id   text
);

-- ---- Sonradan eklenen kolonlar ---------------------------------------------
-- `create table if not exists` MEVCUT bir tabloya kolon EKLEMEZ. Bu yüzden
-- yeni kolonlar ayrıca burada da idempotent şekilde ekleniyor; böylece bu
-- dosya hem sıfırdan hem de zaten kurulu bir veritabanında güvenle çalışır.
-- (Aynısı supabase/migrations/ altında da tek başına duruyor.)
alter table public.courses         add column if not exists grade integer;
alter table public.absence_records add column if not exists note  text;

create index if not exists idx_courses_user on public.courses (user_id);
create index if not exists idx_records_user on public.absence_records (user_id);
create index if not exists idx_semesters_user on public.semesters (user_id);

-- ---- Row Level Security ---------------------------------------------------
alter table public.semesters       enable row level security;
alter table public.courses         enable row level security;
alter table public.absence_records enable row level security;

-- semesters
drop policy if exists "own semesters" on public.semesters;
create policy "own semesters" on public.semesters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- courses
drop policy if exists "own courses" on public.courses;
create policy "own courses" on public.courses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- absence_records
drop policy if exists "own records" on public.absence_records;
create policy "own records" on public.absence_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
