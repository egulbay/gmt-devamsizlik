-- ===========================================================================
-- GMT Takip — Bağlantılar ve Panolar: TEK SEFERDE KURULUM
-- 007 + 008 + 009 + 010 + 011 migration dosyalarının birleşimi.
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
-- ===========================================================================

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


-- ============================================================================
-- GMT Takip — Migration 008  (Bağlantılar ve Panolar · Aşama 1b)
-- Ekler: public.connection_codes, public.code_lookups
--        public.ensure_my_code(), public.rotate_my_code(), public.lookup_code()
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
--
-- AMAÇ: Kullanıcılar birbirini YALNIZCA paylaşılan kodla bulabilsin. Genel
-- arama, kullanıcı listesi, "tanıyor olabileceğin kişiler" YOK. Bu yüzden
-- istemci profiles/connection_codes tablolarını tarayamaz; kod sorgulama
-- yalnızca aşağıdaki lookup_code() fonksiyonundan geçer ve hız sınırlıdır.
-- ============================================================================

-- ---------------------------------------------------------------- kodlar ---
create table if not exists public.connection_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.connection_codes enable row level security;

-- Yalnızca kişinin KENDİ kodunu okuması serbest. Yazma politikası bilerek yok:
-- kod üretimi security definer fonksiyonlardan geçer, böylece kimse kendine
-- tahmin edilebilir bir kod seçemez.
drop policy if exists "codes read own" on public.connection_codes;
create policy "codes read own" on public.connection_codes
  for select using (auth.uid() = user_id);

-- --------------------------------------------------- deneme kayıtları ------
-- Kod tarama (deneme-yanılma) girişimlerini sınırlamak için. Hiç RLS
-- politikası YOK: yalnızca security definer fonksiyonlar yazabilir/okuyabilir.
create table if not exists public.code_lookups (
  id      bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now(),
  found   boolean not null
);
create index if not exists code_lookups_user_at on public.code_lookups (user_id, at desc);
alter table public.code_lookups enable row level security;

-- ------------------------------------------------------- kod üretimi -------
-- Karışabilecek karakterler (0/O, 1/I/L) alfabede YOK. 31 karakter, 8 hane
-- → ~8.5 x 10^11 olasılık. Rastgelelik kriptografik kaynaktan
-- (gen_random_uuid) geliyor; sıralı ID ya da e-postayla hiçbir ilgisi yok.
create or replace function public.social_random_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  hex text := replace(pg_catalog.gen_random_uuid()::text, '-', '');
  out_code text := '';
  i int;
  n int;
begin
  for i in 1..8 loop
    n := ('x' || substr(hex, i * 2 - 1, 2))::bit(8)::int;
    out_code := out_code || substr(alphabet, 1 + (n % 31), 1);
  end loop;
  return 'GMT-' || substr(out_code, 1, 4) || '-' || substr(out_code, 5, 4);
end $$;

-- Kodu olan kullanıcı için mevcut kodu, yoksa yeni üretip döndürür.
create or replace function public.ensure_my_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  existing text;
  candidate text;
begin
  if uid is null then
    raise exception 'auth_required';
  end if;
  select code into existing from public.connection_codes where user_id = uid;
  if existing is not null then
    return existing;
  end if;
  -- Çakışma olasılığı çok düşük ama unique kısıt yine de son sözü söyler.
  for i in 1..10 loop
    candidate := public.social_random_code();
    begin
      insert into public.connection_codes (user_id, code) values (uid, candidate);
      return candidate;
    exception
      when unique_violation then
        -- Aynı anda başka bir cihaz kod ürettiyse onunkini kullan.
        select code into existing from public.connection_codes where user_id = uid;
        if existing is not null then
          return existing;
        end if;
        -- Kod çakıştıysa döngü yeni bir tane dener.
    end;
  end loop;
  raise exception 'code_generation_failed';
end $$;

-- Kodu yeniler: eski kod ANINDA geçersiz olur (eski davet linkleri çalışmaz).
create or replace function public.rotate_my_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  candidate text;
begin
  if uid is null then
    raise exception 'auth_required';
  end if;
  for i in 1..10 loop
    candidate := public.social_random_code();
    begin
      insert into public.connection_codes (user_id, code) values (uid, candidate)
        on conflict (user_id) do update set code = excluded.code, created_at = now();
      return candidate;
    exception
      when unique_violation then
        -- Üretilen kod başkasında: yeniden dene.
    end;
  end loop;
  raise exception 'code_generation_failed';
end $$;

-- ------------------------------------------------------ kod sorgulama ------
-- Kodla kişi bulur. İstemci profiles tablosunu TARAYAMAZ; buradan da yalnızca
-- görünen ad ve fotoğraf döner — bölüm/sınıf ancak bağlantı kabul edilince
-- görünür (Aşama 1c). Böylece kod eline geçen biri kişinin tüm profilini
-- öğrenemez, yalnızca "doğru kişi mi" diye bakabilir.
--
-- HIZ SINIRI: 10 dakikada en fazla 10 deneme. Deneme-yanılma ile kod taramayı
-- bu engeller: 8.5 x 10^11 olasılığı bu hızla taramak milyonlarca yıl sürer.
create or replace function public.lookup_code(p_code text)
returns table (user_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  norm text;
  recent int;
  target uuid;
begin
  if uid is null then
    raise exception 'auth_required';
  end if;

  -- Eski denemeleri temizle (tablo şişmesin).
  delete from public.code_lookups where at < now() - interval '1 day';

  select count(*) into recent
    from public.code_lookups
   where code_lookups.user_id = uid and at > now() - interval '10 minutes';
  if recent >= 10 then
    raise exception 'rate_limited';
  end if;

  -- Yazım farklarını hoşgör: küçük harf, boşluk, tire serbest.
  norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if length(norm) = 11 and left(norm, 3) = 'GMT' then
    norm := substr(norm, 4);
  end if;
  if length(norm) <> 8 then
    insert into public.code_lookups (user_id, found) values (uid, false);
    return;
  end if;
  norm := 'GMT-' || substr(norm, 1, 4) || '-' || substr(norm, 5, 4);

  select c.user_id into target from public.connection_codes c where c.code = norm;

  insert into public.code_lookups (user_id, found) values (uid, target is not null);

  if target is null or target = uid then
    -- Kendi kodunu aratmak da "bulunamadı" sayılır; istemci bunu ayrıca
    -- kendi kodundan anlar ve uygun mesajı gösterir.
    return;
  end if;

  return query
    select p.user_id, p.display_name, p.avatar_url
      from public.profiles p
     where p.user_id = target;
end $$;

-- Fonksiyonları yalnızca giriş yapmış kullanıcılar çağırabilir.
revoke all on function public.ensure_my_code() from public, anon;
revoke all on function public.rotate_my_code() from public, anon;
revoke all on function public.lookup_code(text) from public, anon;
revoke all on function public.social_random_code() from public, anon, authenticated;
grant execute on function public.ensure_my_code() to authenticated;
grant execute on function public.rotate_my_code() to authenticated;
grant execute on function public.lookup_code(text) to authenticated;


-- ============================================================================
-- GMT Takip — Migration 009  (Bağlantılar ve Panolar · Aşama 1c)
-- Ekler: connection_requests, connections, blocks + istek/kabul/engelleme
--        fonksiyonları. lookup_code() ilişki durumunu da döndürecek şekilde
--        yeniden oluşturulur.
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
--
-- KURAL: Kabul edilene kadar taraflar birbirinin profilini GÖRMEZ (yalnızca
-- ad ve fotoğraf). Engellenen kişi istek gönderemez ve engellendiğini
-- anlamaz — "bulunamadı" der gibi davranırız.
-- ============================================================================

-- ------------------------------------------------------------- tablolar ----
-- Bağlantı SİMETRİK tutuluyor: kabul edilince iki satır yazılır (a→b, b→a).
-- Böylece "bağlantılarım" sorgusu tek satır okumasıyla ve basit bir RLS
-- kuralıyla çalışır.
create table if not exists public.connections (
  user_id    uuid not null references auth.users (id) on delete cascade,
  peer_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, peer_id),
  check (user_id <> peer_id)
);

create table if not exists public.connection_requests (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users (id) on delete cascade,
  to_user      uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
-- Aynı kişiye aynı anda tek bekleyen istek.
create unique index if not exists connection_requests_pending
  on public.connection_requests (from_user, to_user) where status = 'pending';
create index if not exists connection_requests_inbox
  on public.connection_requests (to_user, status);

create table if not exists public.blocks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);

alter table public.connections         enable row level security;
alter table public.connection_requests enable row level security;
alter table public.blocks              enable row level security;

-- Okuma serbest (yalnızca kendi satırların); YAZMA politikası bilerek yok:
-- her değişiklik aşağıdaki fonksiyonlardan geçer, böylece engel kontrolü ve
-- karşılıklılık atlanamaz.
drop policy if exists "connections read own" on public.connections;
create policy "connections read own" on public.connections
  for select using (auth.uid() = user_id);

drop policy if exists "requests read own" on public.connection_requests;
create policy "requests read own" on public.connection_requests
  for select using (auth.uid() = from_user or auth.uid() = to_user);

drop policy if exists "blocks read own" on public.blocks;
create policy "blocks read own" on public.blocks
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------ yardımcılar --
create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.connections c where c.user_id = a and c.peer_id = b);
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks bl
     where (bl.user_id = a and bl.blocked_id = b)
        or (bl.user_id = b and bl.blocked_id = a)
  );
$$;

-- Profil okuma kuralı genişliyor: kendisi + BAĞLANTILARI. (Ortak pano üyeleri
-- Aşama 2'de eklenecek.) Engellenen taraf bağlantı listesinde zaten olmadığı
-- için profili de göremez.
drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles read own or connected" on public.profiles;
create policy "profiles read own or connected" on public.profiles
  for select using (
    auth.uid() = user_id
    or public.are_connected(auth.uid(), user_id)
  );

-- --------------------------------------------------------------- istekler --
-- İstek gönderir. Karşı taraf zaten bize istek göndermişse ikisi de istediği
-- için doğrudan bağlanırız (karşılıklı istek = kabul).
-- Dönüş: 'sent' | 'connected' | 'already' | 'blocked' | 'self'
create or replace function public.send_connection_request(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  reverse_id uuid;
begin
  if uid is null then raise exception 'auth_required'; end if;
  if p_user_id is null or p_user_id = uid then return 'self'; end if;
  -- Hedef kullanıcı gerçekten var mı (profili oluşturulmuş mu)?
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id) then
    return 'blocked'; -- yok olan kullanıcıyla engellenen aynı cevabı alır
  end if;
  -- Engel iki yönde de geçerli. Engellendiğini karşı tarafa BELLİ ETMİYORUZ.
  if public.is_blocked_between(uid, p_user_id) then return 'blocked'; end if;
  if public.are_connected(uid, p_user_id) then return 'already'; end if;

  select r.id into reverse_id
    from public.connection_requests r
   where r.from_user = p_user_id and r.to_user = uid and r.status = 'pending';

  if reverse_id is not null then
    update public.connection_requests
       set status = 'accepted', responded_at = now()
     where id = reverse_id;
    insert into public.connections (user_id, peer_id) values (uid, p_user_id), (p_user_id, uid)
      on conflict do nothing;
    return 'connected';
  end if;

  insert into public.connection_requests (from_user, to_user) values (uid, p_user_id)
    on conflict do nothing;
  return 'sent';
end $$;

-- Gelen isteği kabul/ret. Yalnızca isteğin ALICISI çağırabilir.
create or replace function public.respond_connection_request(p_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  req record;
begin
  if uid is null then raise exception 'auth_required'; end if;
  select * into req from public.connection_requests r
    where r.id = p_id and r.to_user = uid and r.status = 'pending';
  -- record değişkeni satır bulunmasa da "null" olmaz; doğru kontrol FOUND.
  if not found then return 'notFound'; end if;

  if p_accept then
    if public.is_blocked_between(uid, req.from_user) then
      update public.connection_requests set status = 'declined', responded_at = now() where id = p_id;
      return 'blocked';
    end if;
    update public.connection_requests set status = 'accepted', responded_at = now() where id = p_id;
    insert into public.connections (user_id, peer_id)
      values (uid, req.from_user), (req.from_user, uid) on conflict do nothing;
    return 'accepted';
  end if;

  update public.connection_requests set status = 'declined', responded_at = now() where id = p_id;
  return 'declined';
end $$;

-- Gönderdiğim isteği geri çekerim.
create or replace function public.cancel_connection_request(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth_required'; end if;
  update public.connection_requests set status = 'cancelled', responded_at = now()
   where id = p_id and from_user = uid and status = 'pending';
  return 'cancelled';
end $$;

-- ------------------------------------------------------- listeleme (RPC) ---
-- Bekleyen istekler ve bağlantılar, gönderenin/kişinin adıyla birlikte.
-- Profil okuma kuralı henüz bağlanmamış kişiyi kapsamadığı için liste
-- sunucudan geliyor; yine de yalnızca ad ve fotoğraf paylaşılıyor.
create or replace function public.list_connection_requests()
returns table (id uuid, direction text, user_id uuid, display_name text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id,
         case when r.to_user = auth.uid() then 'incoming' else 'outgoing' end,
         case when r.to_user = auth.uid() then r.from_user else r.to_user end,
         p.display_name,
         p.avatar_url,
         r.created_at
    from public.connection_requests r
    join public.profiles p
      on p.user_id = case when r.to_user = auth.uid() then r.from_user else r.to_user end
   where r.status = 'pending'
     and (r.to_user = auth.uid() or r.from_user = auth.uid())
   order by r.created_at desc;
$$;

create or replace function public.list_connections()
returns table (user_id uuid, display_name text, department text, class_year smallint, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name, p.department, p.class_year, p.avatar_url
    from public.connections c
    join public.profiles p on p.user_id = c.peer_id
   where c.user_id = auth.uid()
   order by p.display_name;
$$;

-- --------------------------------------------------- kaldırma / engelleme --
create or replace function public.remove_connection(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth_required'; end if;
  delete from public.connections
   where (user_id = uid and peer_id = p_user_id) or (user_id = p_user_id and peer_id = uid);
  return 'removed';
end $$;

-- Engelleme: bağlantıyı koparır, bekleyen istekleri iptal eder ve yeni istek
-- gelmesini engeller.
create or replace function public.block_user(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth_required'; end if;
  if p_user_id = uid then return 'self'; end if;
  insert into public.blocks (user_id, blocked_id) values (uid, p_user_id) on conflict do nothing;
  delete from public.connections
   where (user_id = uid and peer_id = p_user_id) or (user_id = p_user_id and peer_id = uid);
  update public.connection_requests set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and ((from_user = uid and to_user = p_user_id) or (from_user = p_user_id and to_user = uid));
  return 'blocked';
end $$;

create or replace function public.unblock_user(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth_required'; end if;
  delete from public.blocks where user_id = uid and blocked_id = p_user_id;
  return 'unblocked';
end $$;

create or replace function public.list_blocks()
returns table (user_id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name, p.avatar_url
    from public.blocks b
    join public.profiles p on p.user_id = b.blocked_id
   where b.user_id = auth.uid()
   order by p.display_name;
$$;

-- ------------------------------------------- kod sorgulama (ilişkili hali) --
-- Artık ilişki durumunu da döndürüyor ki arayüz doğru butonu göstersin.
-- Engelli taraf "bulunamadı" alır: engellendiğini öğrenemez.
drop function if exists public.lookup_code(text);
create or replace function public.lookup_code(p_code text)
returns table (user_id uuid, display_name text, avatar_url text, relation text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  norm text;
  recent int;
  target uuid;
  rel text;
begin
  if uid is null then raise exception 'auth_required'; end if;

  delete from public.code_lookups where at < now() - interval '1 day';

  select count(*) into recent
    from public.code_lookups
   where code_lookups.user_id = uid and at > now() - interval '10 minutes';
  if recent >= 10 then raise exception 'rate_limited'; end if;

  norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if length(norm) = 11 and left(norm, 3) = 'GMT' then norm := substr(norm, 4); end if;
  if length(norm) <> 8 then
    insert into public.code_lookups (user_id, found) values (uid, false);
    return;
  end if;
  norm := 'GMT-' || substr(norm, 1, 4) || '-' || substr(norm, 5, 4);

  select c.user_id into target from public.connection_codes c where c.code = norm;
  insert into public.code_lookups (user_id, found) values (uid, target is not null);

  if target is null or target = uid then return; end if;
  if public.is_blocked_between(uid, target) then return; end if;

  if public.are_connected(uid, target) then
    rel := 'connected';
  elsif exists (select 1 from public.connection_requests r
                 where r.from_user = uid and r.to_user = target and r.status = 'pending') then
    rel := 'outgoing';
  elsif exists (select 1 from public.connection_requests r
                 where r.from_user = target and r.to_user = uid and r.status = 'pending') then
    rel := 'incoming';
  else
    rel := 'none';
  end if;

  return query
    select p.user_id, p.display_name, p.avatar_url, rel
      from public.profiles p
     where p.user_id = target;
end $$;

-- ------------------------------------------------------------- yetkiler ----
revoke all on function public.lookup_code(text) from public, anon;
grant execute on function public.lookup_code(text) to authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'send_connection_request(uuid)', 'respond_connection_request(uuid,boolean)',
    'cancel_connection_request(uuid)', 'list_connection_requests()', 'list_connections()',
    'remove_connection(uuid)', 'block_user(uuid)', 'unblock_user(uuid)', 'list_blocks()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
-- Yardımcılar yalnızca politikalar/fonksiyonlar içinden kullanılır.
revoke all on function public.are_connected(uuid, uuid) from public, anon;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.are_connected(uuid, uuid) to authenticated;


-- ============================================================================
-- GMT Takip — Migration 010  (Bağlantılar ve Panolar · Aşama 2)
-- Ekler: workspaces, workspace_members, boards, board_members, cards,
--        card_assignees, board_activity, board_invites + yetki fonksiyonları.
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
--
-- YAPI: çalışma alanı (workspace) → panolar (board) → kartlar (card).
--   · Kişisel kullanım: kimseyi davet etmezsen alan yalnızca sana görünür.
--   · Topluluk: "GMT" alanı altında birden çok pano (Sosyal Medya, Ar-Ge…).
--   · Ders projesi: pano bir derse bağlanabilir ama bu bağ KİŞİSELDİR
--     (board_course_links) — ders adın diğer üyelere GÖSTERİLMEZ, çünkü
--     dersler ve devamsızlık verisi kimseyle paylaşılmaz.
--
-- ROLLER: owner (her şey) > admin (pano açar, üye ekler/çıkarır, kart siler)
--         > member (kart ekler/günceller, durum değiştirir).
-- ============================================================================

-- ------------------------------------------------------------- tablolar ----
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid not null references auth.users (id) on delete cascade,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.boards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  -- Varsayılan görünüm: ders projelerinde liste, topluluk panolarında kanban.
  view_mode    text not null default 'list' check (view_mode in ('list', 'kanban')),
  created_by   uuid not null references auth.users (id) on delete cascade,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Yalnızca TEK bir panoya davet edilenler. Alan üyeleri zaten tüm panoları
-- görür; bu tablo "sadece şu panoya çağırdım" durumu içindir.
create table if not exists public.board_members (
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  notes        text check (notes is null or char_length(notes) <= 2000),
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  due_date     date,
  position     double precision not null default 0,
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_by   uuid not null references auth.users (id) on delete cascade,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Çakışma çözümü için (mevcut senkron düzeniyle aynı mantık).
  client_id    text
);
create index if not exists cards_board on public.cards (board_id, status, position);

create table if not exists public.card_assignees (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (card_id, user_id)
);

create table if not exists public.board_activity (
  id         bigserial primary key,
  board_id   uuid not null references public.boards (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  kind       text not null,
  card_title text,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists board_activity_board on public.board_activity (board_id, created_at desc);

-- Süreli ve iptal edilebilir davet kodları (alan ya da pano için).
create table if not exists public.board_invites (
  code         text primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  board_id     uuid references public.boards (id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_by   uuid not null references auth.users (id) on delete cascade,
  expires_at   timestamptz not null,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  check (workspace_id is not null or board_id is not null)
);

-- Panonun hangi derse ait olduğu: SADECE kişinin kendisi görür.
create table if not exists public.board_course_links (
  user_id   uuid not null references auth.users (id) on delete cascade,
  board_id  uuid not null references public.boards (id) on delete cascade,
  course_id text not null,
  primary key (user_id, board_id)
);

-- ------------------------------------------------------ yetki fonksiyonları -
-- Bir kullanıcının panodaki rolü: alan rolü ile pano rolünün GÜÇLÜ olanı.
-- Tüm politikalar bunun üzerinden yazılır; böylece kural tek yerde durur.
create or replace function public.board_role(p_board uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when max(lvl) = 3 then 'owner'
    when max(lvl) = 2 then 'admin'
    when max(lvl) = 1 then 'member'
    else null
  end
  from (
    select case wm.role when 'owner' then 3 when 'admin' then 2 else 1 end as lvl
      from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
     where b.id = p_board and wm.user_id = p_user and b.deleted = false
    union all
    select case bm.role when 'admin' then 2 else 1 end
      from public.board_members bm
      join public.boards b2 on b2.id = bm.board_id
     where bm.board_id = p_board and bm.user_id = p_user and b2.deleted = false
  ) r;
$$;

create or replace function public.workspace_role(p_workspace uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select wm.role from public.workspace_members wm
   where wm.workspace_id = p_workspace and wm.user_id = p_user;
$$;

-- Panoyu görebiliyor muyum? (üyeysem ya da alan üyesiysem)
create or replace function public.can_see_board(p_board uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.board_role(p_board, auth.uid()) is not null;
$$;

create or replace function public.can_edit_cards(p_board uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.board_role(p_board, auth.uid()) in ('owner', 'admin', 'member');
$$;

create or replace function public.can_manage_board(p_board uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.board_role(p_board, auth.uid()) in ('owner', 'admin');
$$;

-- ------------------------------------------------------------------ RLS ----
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.boards             enable row level security;
alter table public.board_members      enable row level security;
alter table public.cards              enable row level security;
alter table public.card_assignees     enable row level security;
alter table public.board_activity     enable row level security;
alter table public.board_invites      enable row level security;
alter table public.board_course_links enable row level security;

-- Çalışma alanı: üyeler okur, sahibi/yöneticisi adı değiştirir, sahibi siler.
drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces
  for select using (public.workspace_role(id, auth.uid()) is not null);

drop policy if exists "ws insert" on public.workspaces;
create policy "ws insert" on public.workspaces
  for insert with check (auth.uid() = created_by);

drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces
  for update using (public.workspace_role(id, auth.uid()) in ('owner', 'admin'))
  with check (public.workspace_role(id, auth.uid()) in ('owner', 'admin'));

drop policy if exists "ws delete" on public.workspaces;
create policy "ws delete" on public.workspaces
  for delete using (public.workspace_role(id, auth.uid()) = 'owner');

-- Üyelikler: aynı alandaki herkes birbirini görür (aynı takımdalar).
-- Değişiklikler fonksiyonlardan geçer; kimse kendini yönetici yapamaz.
drop policy if exists "ws members read" on public.workspace_members;
create policy "ws members read" on public.workspace_members
  for select using (public.workspace_role(workspace_id, auth.uid()) is not null);

-- Alanı KURAN kişinin kendini sahip olarak eklemesi (tek istisna).
drop policy if exists "ws members bootstrap" on public.workspace_members;
create policy "ws members bootstrap" on public.workspace_members
  for insert with check (
    auth.uid() = user_id
    and role = 'owner'
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.created_by = auth.uid())
  );

-- Panolar
drop policy if exists "boards read" on public.boards;
create policy "boards read" on public.boards
  for select using (public.can_see_board(id));

drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards
  for insert with check (
    auth.uid() = created_by
    and public.workspace_role(workspace_id, auth.uid()) in ('owner', 'admin')
  );

drop policy if exists "boards update" on public.boards;
create policy "boards update" on public.boards
  for update using (public.can_manage_board(id)) with check (public.can_manage_board(id));

drop policy if exists "boards delete" on public.boards;
create policy "boards delete" on public.boards
  for delete using (public.board_role(id, auth.uid()) = 'owner');

drop policy if exists "board members read" on public.board_members;
create policy "board members read" on public.board_members
  for select using (public.can_see_board(board_id));

-- Kartlar: panoyu gören okur, üye ve üstü yazar, SİLME yönetici işidir
-- (üye yanlışlıkla ya da kızgınlıkla panoyu boşaltamasın; "tamamlandı"
-- işaretlemek zaten üyenin yetkisinde).
drop policy if exists "cards read" on public.cards;
create policy "cards read" on public.cards
  for select using (public.can_see_board(board_id));

drop policy if exists "cards insert" on public.cards;
create policy "cards insert" on public.cards
  for insert with check (public.can_edit_cards(board_id) and auth.uid() = created_by);

drop policy if exists "cards update" on public.cards;
create policy "cards update" on public.cards
  for update using (public.can_edit_cards(board_id)) with check (public.can_edit_cards(board_id));

drop policy if exists "cards delete" on public.cards;
create policy "cards delete" on public.cards
  for delete using (public.can_manage_board(board_id));

drop policy if exists "assignees read" on public.card_assignees;
create policy "assignees read" on public.card_assignees
  for select using (exists (select 1 from public.cards c where c.id = card_id and public.can_see_board(c.board_id)));

drop policy if exists "assignees write" on public.card_assignees;
create policy "assignees write" on public.card_assignees
  for all using (exists (select 1 from public.cards c where c.id = card_id and public.can_edit_cards(c.board_id)))
  with check (exists (select 1 from public.cards c where c.id = card_id and public.can_edit_cards(c.board_id)));

-- Aktivite akışı: okuması serbest (pano üyesine), YAZMASI yok — kayıtları
-- tetikleyiciler atar, böylece kimse sahte "şunu tamamladı" satırı yazamaz.
drop policy if exists "activity read" on public.board_activity;
create policy "activity read" on public.board_activity
  for select using (public.can_see_board(board_id));

-- Davetler: yöneticiler görür/iptal eder. Kodun kendisiyle katılma
-- fonksiyondan geçer (aşağıda), tabloyu okumak gerekmez.
drop policy if exists "invites read" on public.board_invites;
create policy "invites read" on public.board_invites
  for select using (
    (board_id is not null and public.can_manage_board(board_id))
    or (workspace_id is not null and public.workspace_role(workspace_id, auth.uid()) in ('owner', 'admin'))
  );

drop policy if exists "invites revoke" on public.board_invites;
create policy "invites revoke" on public.board_invites
  for update using (
    (board_id is not null and public.can_manage_board(board_id))
    or (workspace_id is not null and public.workspace_role(workspace_id, auth.uid()) in ('owner', 'admin'))
  ) with check (true);

-- Pano–ders bağı yalnızca kişinin kendisine ait.
drop policy if exists "board course link own" on public.board_course_links;
create policy "board course link own" on public.board_course_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Profil okuma kuralına "ortak pano üyeleri" eklenir.
create or replace function public.shares_board_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.workspace_members a
      join public.workspace_members b on b.workspace_id = a.workspace_id
     where a.user_id = auth.uid() and b.user_id = p_user
    union all
    select 1
      from public.board_members a2
      join public.board_members b2 on b2.board_id = a2.board_id
     where a2.user_id = auth.uid() and b2.user_id = p_user
    union all
    select 1
      from public.board_members bm
      join public.boards b3 on b3.id = bm.board_id
      join public.workspace_members wm on wm.workspace_id = b3.workspace_id
     where (bm.user_id = auth.uid() and wm.user_id = p_user)
        or (wm.user_id = auth.uid() and bm.user_id = p_user)
  );
$$;
grant execute on function public.shares_board_with(uuid) to authenticated;

drop policy if exists "profiles read own or connected" on public.profiles;
create policy "profiles read own, connected or board mate" on public.profiles
  for select using (
    auth.uid() = user_id
    or public.are_connected(auth.uid(), user_id)
    or public.shares_board_with(user_id)
  );

-- ------------------------------------------------------ aktivite kayıtları --
-- Kart eklenince / durum değişince / tamamlanınca akışa satır düşer.
create or replace function public.card_activity_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.board_activity (board_id, actor_id, kind, card_title)
      values (new.board_id, auth.uid(), 'card_added', new.title);
  elsif tg_op = 'UPDATE' then
    if new.deleted and not old.deleted then
      insert into public.board_activity (board_id, actor_id, kind, card_title)
        values (new.board_id, auth.uid(), 'card_deleted', new.title);
    elsif new.status is distinct from old.status then
      insert into public.board_activity (board_id, actor_id, kind, card_title, detail)
        values (new.board_id, auth.uid(), 'status_changed', new.title, new.status);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cards_activity on public.cards;
create trigger cards_activity after insert or update on public.cards
  for each row execute function public.card_activity_trigger();

drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards
  for each row execute function public.social_touch_updated_at();
drop trigger if exists boards_touch on public.boards;
create trigger boards_touch before update on public.boards
  for each row execute function public.social_touch_updated_at();
drop trigger if exists ws_touch on public.workspaces;
create trigger ws_touch before update on public.workspaces
  for each row execute function public.social_touch_updated_at();


-- ============================================================================
-- GMT Takip — Migration 011  (Bağlantılar ve Panolar · Aşama 2, işlemler)
-- Ekler: alan/pano kurma, üye ekleme-çıkarma, rol değiştirme, davet kodu ile
--        katılma ve "bana atananlar" fonksiyonları.
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Geri almak için: supabase/rollback/social_rollback.sql
--
-- NEDEN FONKSİYON: Üyelik değişiklikleri tek bir yerde toplanıyor ki
-- "yalnızca yönetici ekleyebilir", "yalnızca bağlantın olan kişiyi
-- ekleyebilirsin" ve "son sahip çıkamaz" kuralları atlanamasın.
-- ============================================================================

-- Alan kurar ve kuranı sahip yapar (tek işlemde, yarım kalmasın diye).
create or replace function public.create_workspace(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'auth_required'; end if;
  insert into public.workspaces (name, created_by) values (btrim(p_name), uid) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_id, uid, 'owner');
  return new_id;
end $$;

create or replace function public.create_board(p_workspace uuid, p_name text, p_view text default 'list')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'auth_required'; end if;
  if public.workspace_role(p_workspace, uid) not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;
  insert into public.boards (workspace_id, name, view_mode, created_by)
    values (p_workspace, btrim(p_name), case when p_view = 'kanban' then 'kanban' else 'list' end, uid)
    returning id into new_id;
  return new_id;
end $$;

-- Bağlantı listesinden üye ekleme. Bağlantın OLMAYAN birini ekleyemezsin:
-- aksi halde kullanıcı kimliği tahmin edilerek panoya yabancı sokulabilirdi.
create or replace function public.add_member(
  p_workspace uuid, p_board uuid, p_user uuid, p_role text default 'member'
) returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); role_ok text;
begin
  if uid is null then raise exception 'auth_required'; end if;
  if not public.are_connected(uid, p_user) then return 'not_connected'; end if;
  if public.is_blocked_between(uid, p_user) then return 'blocked'; end if;
  role_ok := case when p_role = 'admin' then 'admin' else 'member' end;

  if p_board is not null then
    if not public.can_manage_board(p_board) then return 'not_allowed'; end if;
    insert into public.board_members (board_id, user_id, role) values (p_board, p_user, role_ok)
      on conflict (board_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;

  if public.workspace_role(p_workspace, uid) not in ('owner', 'admin') then return 'not_allowed'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (p_workspace, p_user, role_ok)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
  return 'added';
end $$;

create or replace function public.remove_member(p_workspace uuid, p_board uuid, p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); owners int;
begin
  if uid is null then raise exception 'auth_required'; end if;

  if p_board is not null then
    -- Kendini çıkarmak her zaman serbest; başkasını çıkarmak yönetici işi.
    if p_user <> uid and not public.can_manage_board(p_board) then return 'not_allowed'; end if;
    delete from public.board_members where board_id = p_board and user_id = p_user;
    return 'removed';
  end if;

  if p_user <> uid and public.workspace_role(p_workspace, uid) not in ('owner', 'admin') then
    return 'not_allowed';
  end if;
  -- Son sahibi çıkarma: alan sahipsiz kalmasın.
  select count(*) into owners from public.workspace_members
   where workspace_id = p_workspace and role = 'owner';
  if owners <= 1 and public.workspace_role(p_workspace, p_user) = 'owner' then
    return 'last_owner';
  end if;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  return 'removed';
end $$;

create or replace function public.set_member_role(p_workspace uuid, p_board uuid, p_user uuid, p_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); owners int;
begin
  if uid is null then raise exception 'auth_required'; end if;

  if p_board is not null then
    if not public.can_manage_board(p_board) then return 'not_allowed'; end if;
    update public.board_members set role = case when p_role = 'admin' then 'admin' else 'member' end
     where board_id = p_board and user_id = p_user;
    return 'ok';
  end if;

  -- Alanda rol değiştirmek yalnızca SAHİBİN işi; yönetici kendini sahip
  -- yapamasın diye admin'e izin verilmiyor.
  if public.workspace_role(p_workspace, uid) <> 'owner' then return 'not_allowed'; end if;
  select count(*) into owners from public.workspace_members
   where workspace_id = p_workspace and role = 'owner';
  if owners <= 1 and p_user = uid and p_role <> 'owner' then return 'last_owner'; end if;
  update public.workspace_members
     set role = case when p_role in ('owner', 'admin') then p_role else 'member' end
   where workspace_id = p_workspace and user_id = p_user;
  return 'ok';
end $$;

-- ------------------------------------------------------------- davetler ----
-- Süreli davet kodu. Bağlantı kodundan farklı olarak bu kod PANOYA aittir,
-- süresi dolar ve iptal edilebilir.
create or replace function public.create_invite(
  p_workspace uuid, p_board uuid, p_role text default 'member', p_hours int default 48
) returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  code text;
  hours int := least(greatest(coalesce(p_hours, 48), 1), 720);
begin
  if uid is null then raise exception 'auth_required'; end if;
  if p_board is not null then
    if not public.can_manage_board(p_board) then raise exception 'not_allowed'; end if;
  elsif public.workspace_role(p_workspace, uid) not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  for i in 1..10 loop
    code := replace(public.social_random_code(), 'GMT-', 'PANO-');
    begin
      insert into public.board_invites (code, workspace_id, board_id, role, created_by, expires_at)
        values (code, p_workspace, p_board,
                case when p_role = 'admin' then 'admin' else 'member' end,
                uid, now() + make_interval(hours => hours));
      return code;
    exception when unique_violation then
      -- kod çakıştı, yeniden dene
    end;
  end loop;
  raise exception 'code_generation_failed';
end $$;

create or replace function public.revoke_invite(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); inv record;
begin
  if uid is null then raise exception 'auth_required'; end if;
  select * into inv from public.board_invites where code = p_code;
  if not found then return 'notFound'; end if;
  if inv.board_id is not null then
    if not public.can_manage_board(inv.board_id) then return 'not_allowed'; end if;
  elsif public.workspace_role(inv.workspace_id, uid) not in ('owner', 'admin') then
    return 'not_allowed';
  end if;
  update public.board_invites set revoked = true where code = p_code;
  return 'revoked';
end $$;

-- Davet koduyla katılma. Süresi dolmuş / iptal edilmiş kod çalışmaz.
create or replace function public.join_with_invite(p_code text)
returns table (kind text, target_name text) language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  inv record;
  norm text;
begin
  if uid is null then raise exception 'auth_required'; end if;
  norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if left(norm, 4) = 'PANO' then norm := substr(norm, 5); end if;
  if length(norm) <> 8 then
    return query select 'invalid'::text, null::text; return;
  end if;
  norm := 'PANO-' || substr(norm, 1, 4) || '-' || substr(norm, 5, 4);

  select * into inv from public.board_invites where code = norm;
  if not found or inv.revoked or inv.expires_at < now() then
    return query select 'invalid'::text, null::text; return;
  end if;
  if public.is_blocked_between(uid, inv.created_by) then
    return query select 'invalid'::text, null::text; return;
  end if;

  if inv.board_id is not null then
    insert into public.board_members (board_id, user_id, role) values (inv.board_id, uid, inv.role)
      on conflict (board_id, user_id) do nothing;
    return query select 'board'::text, (select b.name from public.boards b where b.id = inv.board_id);
  else
    insert into public.workspace_members (workspace_id, user_id, role) values (inv.workspace_id, uid, inv.role)
      on conflict (workspace_id, user_id) do nothing;
    return query select 'workspace'::text, (select w.name from public.workspaces w where w.id = inv.workspace_id);
  end if;
end $$;

-- ------------------------------------------------------------ listeleme ----
-- Panodaki kişiler ve rolleri (kart atarken gerekiyor).
create or replace function public.list_board_people(p_board uuid)
returns table (user_id uuid, display_name text, avatar_url text, role text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name, p.avatar_url, public.board_role(p_board, p.user_id)
    from public.profiles p
   where public.can_see_board(p_board)
     and public.board_role(p_board, p.user_id) is not null;
$$;

-- "Bana atananlar": tüm panolardaki açık kartlarım, pano adıyla.
-- NOT: Dönüş listesinde "position" adı KULLANILAMAZ — PostgreSQL'de position()
-- bir işlev adı olduğu için orada sözdizimi hatası veriyor. Sıra bilgisine
-- bu ekranda zaten gerek yok; yalnızca sıralamak için kullanılıyor.
create or replace function public.my_assigned_cards()
returns table (
  card_id uuid, board_id uuid, board_name text, title text,
  status text, due_date date
) language sql stable security definer set search_path = '' as $$
  select c.id, c.board_id, b.name, c.title, c.status, c.due_date
    from public.card_assignees a
    join public.cards c on c.id = a.card_id
    join public.boards b on b.id = c.board_id
   where a.user_id = auth.uid()
     and c.deleted = false
     and b.deleted = false
     and c.status <> 'done'
   order by c.due_date nulls last, c.position;
$$;

-- Aktivite akışı okunurken kim olduğu da lazım.
create or replace function public.list_board_activity(p_board uuid, p_limit int default 30)
returns table (id bigint, actor_name text, kind text, card_title text, detail text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, p.display_name, a.kind, a.card_title, a.detail, a.created_at
    from public.board_activity a
    left join public.profiles p on p.user_id = a.actor_id
   where a.board_id = p_board and public.can_see_board(p_board)
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- ------------------------------------------------------------- yetkiler ----
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_workspace(text)', 'create_board(uuid,text,text)',
    'add_member(uuid,uuid,uuid,text)', 'remove_member(uuid,uuid,uuid)',
    'set_member_role(uuid,uuid,uuid,text)',
    'create_invite(uuid,uuid,text,integer)', 'revoke_invite(text)', 'join_with_invite(text)',
    'list_board_people(uuid)', 'my_assigned_cards()', 'list_board_activity(uuid,integer)',
    'board_role(uuid,uuid)', 'workspace_role(uuid,uuid)', 'can_see_board(uuid)',
    'can_edit_cards(uuid)', 'can_manage_board(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


