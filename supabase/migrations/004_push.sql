-- ============================================================================
-- GMT Takip — Migration 004
-- Ekler:  public.push_subscriptions  (telefonların bildirim aboneliği)
--         public.courses'a bildirim durumu kolonları
--
-- NASIL ÇALIŞTIRILIR
--   Supabase paneli > SQL Editor > New query > tamamını yapıştır > Run.
--   Tekrar çalıştırmak zararsız.
--
-- NEDEN GEREKLİ
--   Bildirimler şimdiye kadar yalnızca uygulama AÇIKKEN hesaplanıyordu.
--   Sunucu, uygulama kapalıyken de hatırlatma gönderebilmek için:
--     - hangi telefona göndereceğini (push_subscriptions),
--     - hangi uyarının daha önce gönderildiğini (courses'taki kolonlar)
--   bilmek zorunda. Bu kolonlar zaten cihazda vardı; artık buluta da yazılıyor
--   ki aynı uyarı iki kez gitmesin.
-- ============================================================================

create table if not exists public.push_subscriptions (
  endpoint    text primary key,          -- tarayıcının verdiği benzersiz adres
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,             -- şifreleme anahtarları
  auth        text not null,
  lang        text not null default 'tr',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists idx_push_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Bildirim durumu: aynı uyarının tekrar tekrar gönderilmesini engeller.
alter table public.courses add column if not exists notified_two_left boolean not null default false;
alter table public.courses add column if not exists notified_limit    boolean not null default false;
alter table public.courses add column if not exists last_weekly_notify_at timestamptz;
