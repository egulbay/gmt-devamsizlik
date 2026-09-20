-- ============================================================================
-- GMT Takip — Migration 005
-- Ekler: public.courses.color  (dersin rengi, isteğe bağlı)
--
-- Supabase paneli > SQL Editor > yapıştır > Run. Tekrar çalıştırmak zararsız.
-- Renk KODU değil palet anahtarı saklanır ("coral", "blue"...), böylece
-- açık/koyu temada farklı ton kullanılabilir. Kolon yoksa uygulama çalışmaya
-- devam eder, renk yalnızca buluta yazılmaz.
-- ============================================================================
alter table public.courses add column if not exists color text;
