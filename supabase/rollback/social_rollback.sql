-- ============================================================================
-- GMT Takip — Bağlantılar ve Panolar özelliğini veritabanından TAMAMEN kaldırır.
--
-- Yalnızca bu özellikle (migration 007–011) gelen tablo/fonksiyonları siler.
-- Dersler, devamsızlık kayıtları, dönemler, projeler, program dosyaları,
-- bildirim abonelikleri ve tercihler DOKUNULMADAN kalır.
-- Tekrar çalıştırmak zararsız.
--
-- DİKKAT: Bağlantılar, panolar, kartlar ve davetler kalıcı olarak silinir.
-- ============================================================================

-- Panolar (Aşama 2)
drop table if exists public.board_course_links cascade;
drop table if exists public.board_invites cascade;
drop table if exists public.board_activity cascade;
drop table if exists public.card_assignees cascade;
drop table if exists public.cards cascade;
drop table if exists public.board_members cascade;
drop table if exists public.boards cascade;
drop table if exists public.workspace_members cascade;
drop table if exists public.workspaces cascade;

-- Bağlantılar (Aşama 1)
drop table if exists public.blocks cascade;
drop table if exists public.connection_requests cascade;
drop table if exists public.connections cascade;
drop table if exists public.code_lookups cascade;
drop table if exists public.connection_codes cascade;
drop table if exists public.profiles cascade;

-- Fonksiyonlar (tabloları düşürmek tetikleyicileri zaten götürür)
drop function if exists public.create_workspace(text) cascade;
drop function if exists public.create_board(uuid, text, text) cascade;
drop function if exists public.add_member(uuid, uuid, uuid, text) cascade;
drop function if exists public.remove_member(uuid, uuid, uuid) cascade;
drop function if exists public.set_member_role(uuid, uuid, uuid, text) cascade;
drop function if exists public.create_invite(uuid, uuid, text, integer) cascade;
drop function if exists public.revoke_invite(text) cascade;
drop function if exists public.join_with_invite(text) cascade;
drop function if exists public.list_board_people(uuid) cascade;
drop function if exists public.my_assigned_cards() cascade;
drop function if exists public.list_board_activity(uuid, integer) cascade;
drop function if exists public.card_activity_trigger() cascade;
drop function if exists public.board_role(uuid, uuid) cascade;
drop function if exists public.workspace_role(uuid, uuid) cascade;
drop function if exists public.can_see_board(uuid) cascade;
drop function if exists public.can_edit_cards(uuid) cascade;
drop function if exists public.can_manage_board(uuid) cascade;
drop function if exists public.shares_board_with(uuid) cascade;
drop function if exists public.send_connection_request(uuid) cascade;
drop function if exists public.respond_connection_request(uuid, boolean) cascade;
drop function if exists public.cancel_connection_request(uuid) cascade;
drop function if exists public.list_connection_requests() cascade;
drop function if exists public.list_connections() cascade;
drop function if exists public.remove_connection(uuid) cascade;
drop function if exists public.block_user(uuid) cascade;
drop function if exists public.unblock_user(uuid) cascade;
drop function if exists public.list_blocks() cascade;
drop function if exists public.are_connected(uuid, uuid) cascade;
drop function if exists public.is_blocked_between(uuid, uuid) cascade;
drop function if exists public.lookup_code(text) cascade;
drop function if exists public.ensure_my_code() cascade;
drop function if exists public.rotate_my_code() cascade;
drop function if exists public.social_random_code() cascade;
drop function if exists public.social_touch_updated_at() cascade;
