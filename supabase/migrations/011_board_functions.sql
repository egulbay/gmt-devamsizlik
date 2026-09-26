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
