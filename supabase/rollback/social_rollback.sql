-- ============================================================================
-- GMT Takip — Bağlantılar ve Panolar özelliğini veritabanından TAMAMEN kaldırır.
--
-- Yalnızca bu özellikle (migration 007 ve sonrası) gelen tablo/fonksiyonları
-- siler. Dersler, devamsızlık kayıtları, dönemler, projeler ve diğer mevcut
-- tablolara DOKUNMAZ. Tekrar çalıştırmak zararsız.
--
-- DİKKAT: Bağlantılar, panolar ve kartlar kalıcı olarak silinir.
-- ============================================================================
drop function if exists public.lookup_code(text) cascade;
drop function if exists public.ensure_my_code() cascade;
drop function if exists public.rotate_my_code() cascade;
drop function if exists public.social_random_code() cascade;
drop table if exists public.code_lookups cascade;
drop table if exists public.connection_codes cascade;
drop table if exists public.profiles cascade;
drop function if exists public.social_touch_updated_at() cascade;
