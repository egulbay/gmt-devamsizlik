-- ============================================================================
-- GMT Takip — Bağlantılar ve Panolar özelliğini veritabanından TAMAMEN kaldırır.
--
-- Yalnızca bu özellikle (migration 007 ve sonrası) gelen tablo/fonksiyonları
-- siler. Dersler, devamsızlık kayıtları, dönemler, projeler ve diğer mevcut
-- tablolara DOKUNMAZ. Tekrar çalıştırmak zararsız.
--
-- DİKKAT: Bağlantılar, panolar ve kartlar kalıcı olarak silinir.
-- ============================================================================
drop table if exists public.profiles cascade;
drop function if exists public.social_touch_updated_at() cascade;
