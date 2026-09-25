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
    when max(rank) = 3 then 'owner'
    when max(rank) = 2 then 'admin'
    when max(rank) = 1 then 'member'
    else null
  end
  from (
    select case wm.role when 'owner' then 3 when 'admin' then 2 else 1 end as rank
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
