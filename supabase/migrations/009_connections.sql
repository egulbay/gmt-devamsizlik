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
