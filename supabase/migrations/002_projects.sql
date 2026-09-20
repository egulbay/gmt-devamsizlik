-- ============================================================================
-- GMT Takip — Migration 002
-- Ekler:  public.projects  (projeler / ödevler + yapılacaklar listesi)
--
-- NASIL ÇALIŞTIRILIR
--   Supabase paneli > SQL Editor > New query > bu dosyanın TAMAMINI yapıştır
--   > Run.  Bir kere çalıştırmak yeterli.
--
-- GÜVENLİ Mİ?
--   Evet. Tamamen idempotent: birden fazla kez çalıştırılabilir, ikincisinde
--   hiçbir şey yapmaz. Var olan tablolara dokunmaz.
--
-- NEDEN GEREKLİ
--   Projeler şimdiye kadar YALNIZCA telefonda saklanıyordu; telefon
--   değiştirildiğinde ya da profil sıfırlandığında kayboluyordu. Bu tablo
--   eklendikten sonra projeler de dersler gibi hesaba yedeklenir.
--   Tablo yokken uygulama çökmez: proje kayıtları kuyrukta bekler ve bu
--   dosya çalıştırıldıktan sonra kendiliğinden yüklenir.
-- ============================================================================

create table if not exists public.projects (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  course_id    text,                       -- hangi derse ait (isteğe bağlı)
  semester_id  text,                       -- dersler gibi döneme bağlı
  due_date     date,                       -- teslim tarihi (isteğe bağlı)
  notes        text,
  todos        jsonb not null default '[]'::jsonb,   -- [{id, text, done}]
  completed    boolean not null default false,
  -- Teslim hatırlatmalarından harcanmış gün eşikleri (14/7/3/1). Cihazlar
  -- arasında taşınır ki aynı hatırlatma ikinci telefonda tekrar gelmesin.
  notified_due_milestones jsonb not null default '[]'::jsonb,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  client_id    text
);

create index if not exists idx_projects_user on public.projects (user_id);

alter table public.projects enable row level security;

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
