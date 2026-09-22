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
