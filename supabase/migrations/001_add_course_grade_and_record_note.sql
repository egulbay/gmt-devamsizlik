-- ============================================================================
-- GMT Devamsızlık — Migration 001
-- Ekler:  public.courses.grade          (ders kaçıncı sınıfın dersi)
--         public.absence_records.note   (devamsızlık açıklaması)
--
-- NASIL ÇALIŞTIRILIR
--   Supabase paneli > SQL Editor > New query > bu dosyanın TAMAMINI yapıştır
--   > Run.  Bir kere çalıştırmak yeterli.
--
-- GÜVENLİ Mİ?
--   Evet. Tamamen idempotent: birden fazla kez çalıştırılabilir, ikinci
--   çalıştırmada hiçbir şey yapmaz. Var olan satırlara dokunmaz — yeni
--   kolonlar nullable olduğu için eski kayıtlarda basitçe NULL kalır.
--   Tabloları hiç kurmadıysanız önce supabase/schema.sql dosyasını
--   çalıştırın; o dosya bu kolonları zaten içeriyor (ve bu migration'ı
--   sonradan çalıştırmak yine de zararsızdır).
--
-- Kolon anlamları
--   courses.grade         0 = Hazırlık, 1..6 = 1..6. sınıf, NULL = belirtilmemiş
--   absence_records.note  serbest metin, uygulama tarafında 280 karakterle sınırlı
-- ============================================================================

alter table public.courses
  add column if not exists grade integer;

alter table public.absence_records
  add column if not exists note text;

-- Uygulama zaten 0..6 aralığını kendisi doğruluyor; kısıt yine de veriyi
-- bozuk istemcilere karşı korur. NULL değerler kısıttan etkilenmez.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_grade_range'
  ) then
    alter table public.courses
      add constraint courses_grade_range
      check (grade is null or (grade >= 0 and grade <= 6));
  end if;
end $$;
