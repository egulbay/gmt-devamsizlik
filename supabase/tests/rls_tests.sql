-- ============================================================================
-- GMT Takip — Güvenlik (RLS) testleri
--
-- NASIL ÇALIŞTIRILIR: Supabase paneli > SQL Editor > bu dosyayı yapıştır > Run.
--
-- SONUÇ: Kırmızı bir kutuda "GMT RLS TEST SONUCU: ..." yazısı çıkar. Bu bir
-- HATA DEĞİL, testin raporudur. Her satırın başında OK ya da HATA yazar.
--
-- VERİTABANINA HİÇBİR ŞEY YAZMAZ: test kullanıcıları ve verileri bir işlem
-- (transaction) içinde oluşturulur, rapor hata olarak fırlatıldığı için
-- işlem geri alınır ve her şey silinir. Kendi verilerine dokunmaz.
-- ============================================================================
do $$
declare
  ua uuid := '11111111-1111-1111-1111-111111111111';
  ub uuid := '22222222-2222-2222-2222-222222222222';
  uc uuid := '33333333-3333-3333-3333-333333333333';
  ws uuid;
  brd uuid;
  crd uuid;
  n int;
  txt text;
  rep text := '';
  fails int := 0;
  -- Testten sonra geri dönülecek rol (Supabase'de genelde postgres).
  orig_role text := current_user;
begin
  -- ---------------------------------------------------------- hazırlık ----
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', ua, 'authenticated', 'authenticated',
     'test-a@example.com', '', now(), now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000000', ub, 'authenticated', 'authenticated',
     'test-b@example.com', '', now(), now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000000', uc, 'authenticated', 'authenticated',
     'test-c@example.com', '', now(), now(), now(), '{}', '{}');

  insert into public.profiles (user_id, display_name, department, class_year)
  values (ua, 'Test A', 'Endüstri', 3), (ub, 'Test B', 'Makine', 2), (uc, 'Test C', null, null);

  insert into public.connection_codes (user_id, code)
  values (ua, 'GMT-TEST-AAAA'), (ub, 'GMT-TEST-BBBB'), (uc, 'GMT-TEST-CCCC');

  -- A'nın devamsızlık verisi (kimse görmemeli)
  insert into public.semesters (id, user_id, name, active, deleted, updated_at, client_id)
  values ('sem_test_a', ua, 'Test Dönem', true, false, now(), 'test');
  insert into public.courses (id, user_id, name, total_hours, semester_id, archived, deleted, updated_at, client_id)
  values ('crs_test_a', ua, 'Gizli Ders', 14, 'sem_test_a', false, false, now(), 'test');

  -- A bir çalışma alanı ve pano kurar, B'yi üye yapar. C dışarıda kalır.
  insert into public.workspaces (name, created_by) values ('Test Alan', ua) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ua, 'owner'), (ws, ub, 'member');
  insert into public.boards (workspace_id, name, created_by) values (ws, 'Test Pano', ua) returning id into brd;
  insert into public.cards (board_id, title, created_by) values (brd, 'Test Kart', ua) returning id into crd;

  -- -------------------------------------------------------------- testler --

  -- 1) Bağlantısız kullanıcı başkasının profilini GÖREMEZ
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles p where p.user_id = ua;
  execute format('set local role %I', orig_role);
  if n = 0 then rep := rep || E'\nOK   1. Bağlantısız kullanıcı başkasının profilini göremiyor';
  else rep := rep || E'\nHATA 1. Bağlantısız kullanıcı profili GÖRDÜ'; fails := fails + 1; end if;

  -- 2) Devamsızlık verisi başkasına KAPALI
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from public.courses c where c.user_id = ua;
  execute format('set local role %I', orig_role);
  if n = 0 then rep := rep || E'\nOK   2. Başkasının dersleri/devamsızlığı görünmüyor';
  else rep := rep || E'\nHATA 2. Başkasının DERSLERİ GÖRÜNDÜ'; fails := fails + 1; end if;

  -- 3) Bağlantı kurulunca profil görünür
  insert into public.connections (user_id, peer_id) values (ua, uc), (uc, ua);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles p where p.user_id = ua;
  execute format('set local role %I', orig_role);
  if n = 1 then rep := rep || E'\nOK   3. Bağlantı kurulunca profil görünüyor';
  else rep := rep || E'\nHATA 3. Bağlantıya rağmen profil görünmedi'; fails := fails + 1; end if;
  delete from public.connections where (user_id = ua and peer_id = uc) or (user_id = uc and peer_id = ua);

  -- 4) Üye olmayan panoyu ve kartlarını OKUYAMAZ
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  select count(*) into n from public.cards c where c.board_id = brd;
  execute format('set local role %I', orig_role);
  if n = 0 then rep := rep || E'\nOK   4. Üye olmayan kişi pano kartlarını okuyamıyor';
  else rep := rep || E'\nHATA 4. Üye olmayan kişi KARTLARI OKUDU'; fails := fails + 1; end if;

  -- 5) Üye panoyu SİLEMEZ
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  delete from public.boards where id = brd;
  get diagnostics n = row_count;
  execute format('set local role %I', orig_role);
  if n = 0 then rep := rep || E'\nOK   5. "Üye" rolündeki kişi panoyu silemiyor';
  else rep := rep || E'\nHATA 5. Üye panoyu SİLDİ'; fails := fails + 1; end if;

  -- 6) Üye kart EKLEYEBİLİR, yabancı EKLEYEMEZ
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  begin
    insert into public.cards (board_id, title, created_by) values (brd, 'Üye kartı', ub);
    txt := 'eklendi';
  exception when others then txt := 'engellendi';
  end;
  execute format('set local role %I', orig_role);
  if txt = 'eklendi' then rep := rep || E'\nOK   6a. Üye kart ekleyebiliyor';
  else rep := rep || E'\nHATA 6a. Üye kart EKLEYEMEDİ'; fails := fails + 1; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  begin
    insert into public.cards (board_id, title, created_by) values (brd, 'Yabancı kartı', uc);
    txt := 'eklendi';
  exception when others then txt := 'engellendi';
  end;
  execute format('set local role %I', orig_role);
  if txt = 'engellendi' then rep := rep || E'\nOK   6b. Üye olmayan kişi kart ekleyemiyor';
  else rep := rep || E'\nHATA 6b. Üye olmayan kişi KART EKLEDİ'; fails := fails + 1; end if;

  -- 7) Engellenen kişi istek gönderemez
  insert into public.blocks (user_id, blocked_id) values (ua, uc);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  select public.send_connection_request(ua) into txt;
  execute format('set local role %I', orig_role);
  if txt = 'blocked' then rep := rep || E'\nOK   7. Engellenen kişi istek gönderemiyor';
  else rep := rep || E'\nHATA 7. Engellenen kişi istek GÖNDERDİ (' || txt || ')'; fails := fails + 1; end if;
  delete from public.blocks where user_id = ua and blocked_id = uc;

  -- 8) Kod sorgulamada hız sınırı (10 dakikada 10 deneme)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  begin
    for i in 1..12 loop
      perform public.lookup_code('GMT-ZZZZ-ZZZZ');
    end loop;
    txt := 'sınırsız';
  exception when others then txt := sqlerrm;
  end;
  execute format('set local role %I', orig_role);
  if txt like '%rate_limited%' then rep := rep || E'\nOK   8. Kod sorgulama hız sınırı çalışıyor';
  else rep := rep || E'\nHATA 8. Hız sınırı ÇALIŞMADI (' || txt || ')'; fails := fails + 1; end if;

  -- 9) Kod sorgulaması e-posta ya da bölüm sızdırmıyor (yalnızca ad + foto)
  execute format('set local role %I', orig_role);
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'email';
  if n = 0 then rep := rep || E'\nOK   9. Profil tablosunda e-posta hiç tutulmuyor';
  else rep := rep || E'\nHATA 9. Profil tablosunda e-posta kolonu VAR'; fails := fails + 1; end if;

  -- 10) Pano üyesi olan kişi (B) A'nın profilini görebilir, dersini göremez
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles p where p.user_id = ua;
  execute format('set local role %I', orig_role);
  if n = 1 then rep := rep || E'\nOK   10. Ortak pano üyesi profili görebiliyor (dersleri değil)';
  else rep := rep || E'\nHATA 10. Ortak pano üyesi profili göremedi'; fails := fails + 1; end if;

  -- --------------------------------------------------------------- rapor --
  raise exception E'GMT RLS TEST SONUCU (% hata):%\n\n(Bu bir hata mesajı değil, rapordur. Tüm test verisi geri alındı.)',
    fails, rep;
end $$;
