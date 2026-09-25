# GMT Takip — Claude için proje notları

Bu dosya, yeni bir sohbete başlandığında projeyi baştan anlatmak zorunda
kalmamak için yazıldı. Kod okunarak anlaşılabilecek şeyler DEĞİL; kararlar,
alışkanlıklar ve tuzaklar burada.

## Konum (önemli)

- **Gerçek proje:** `C:\Users\egulb\OneDrive\Masaüstü\GMT\gmt-devamsizlik`
- `...\Masaüstü\Yeni klasör` altında **başka bir proje** (kişisel portföy
  sitesi) duruyor. GMT ile ilgisi yok, dokunma. Oturumun varsayılan çalışma
  dizini oraya ayarlıysa komutlarda GMT'nin tam yolunu yaz.
- `...\GMT\gmt-devamsizlik-excel-poc` eski bir deneme kopyası; güncel değil.

Yayın: GitHub `egulbay/gmt-devamsizlik` → `main`'e push → Vercel otomatik
deploy → https://gmt-devamsizlik.vercel.app

## Ne olduğu

Kırıkkale Üniversitesi "Geleceğin Meslekleri Topluluğu" için devamsızlık takip
PWA'sı. Türkçe/İngilizce. Kullanıcı: Erdem Gülbay (uygulamayı yapan kişi).

Sekmeler: **Derslerim · Program · Projeler · Ayarlar** (alt çubuk; ortadaki
GMT logosu şimdilik yalnızca görsel, işlevi yok — bilinçli).

## Mimari

- Next.js 15 (App Router) + TypeScript, tek sayfa: `components/App.tsx`
  (büyük dosya, ekranlar `render*` fonksiyonları).
- **Offline-first:** tüm veri IndexedDB'de (Dexie, `lib/db/dexie.ts`).
  localStorage KULLANILMIYOR (ayarlar dahil).
- **Bulut:** Supabase (Google girişi + Postgres). `lib/sync/syncEngine.ts`
  yazma kuyruğu + son-yazan-kazanır birleştirme. Misafir verisi hiç gitmez.
- Service worker `public/sw.js`: app-shell önbelleği + web push altyapısı.

### Senkronize olan / olmayan

| Veri | Buluta gider mi |
|---|---|
| Dersler (+ renk, bildirim durumu), devamsızlık kayıtları, dönemler | Evet |
| Projeler + yapılacaklar + hatırlatma eşikleri | Evet |
| Ders programı fotoğrafı / Excel (Storage "schedules" bucket) | Kod hazır, **migration 003 bekliyor** |
| Tema, dil (`user_prefs`) | Kod hazır, migration 006 bekliyor |
| Bildirim izni, aktif dönem işaretçisi, avatar adresi | **Bilerek hayır** (cihaza özel; aktif dönemi buluta bağlamak eski "dersler görünmez oldu" hatasını geri getirir) |

## Supabase

- Elimizde **yalnızca anon key** var → şema değişikliği yapılamaz.
  `supabase/migrations/*.sql` dosyalarını **kullanıcı** Supabase panelindeki
  SQL Editor'de çalıştırır. Kullanıcıya SQL'i panoya kopyalayıp adımları
  söylemek işe yarıyor.
- Çalıştırıldıktan sonra REST ile doğrula (salt okunur):
  `curl "$URL/rest/v1/<tablo>?select=<kolon>&limit=0" -H "apikey: $KEY" ...`
  Hata dönmüyorsa tablo/kolon hazır.
- **Kural:** Supabase'de bir tablo/kolon yoksa uygulama ÇÖKMEMELİ ve veri
  KAYBOLMAMALI. Kayıtlar kuyrukta bekler, migration çalıştırılınca yüklenir.
  (`optionalColsMissing`, `projectsTableMissing` bunun için.)

Geçmiş olay: `courses.grade` kolonu yokken pull, yereldeki sınıf etiketinin
üstüne `null` yazıyordu ve etiket her açılışta kayboluyordu. Düzeltme:
alan yalnızca bulut satırında **gerçekten varsa** taşınır (`"grade" in c`).

### Migration durumu (supabase/migrations/)

| # | İçerik | Durum |
|---|---|---|
| 001 | courses.grade, absence_records.note | Çalıştırıldı |
| 002 | projects | Çalıştırıldı |
| 003 | schedule_files + Storage bucket | **Bekliyor** (kullanıcı "şimdilik geç" dedi) |
| 004 | push_subscriptions + courses bildirim kolonları | Çalıştırıldı |
| 005 | courses.color | Bekliyor (isteğe bağlı) |
| 006 | user_prefs (tema/dil) | Bekliyor (isteğe bağlı) |
| 007 | profiles (sosyal profil) | Bağlantılar özelliği |
| 008 | connection_codes + lookup_code (hız sınırlı) | Bağlantılar özelliği |
| 009 | connections, connection_requests, blocks | Bağlantılar özelliği |
| 010 | workspaces, boards, cards, roller, RLS | Panolar özelliği |
| 011 | üye/davet/atama fonksiyonları | Panolar özelliği |

007–011 tek dosyada: `supabase/kurulum_baglantilar_panolar.sql`
Geri alma: `supabase/rollback/social_rollback.sql` (yalnızca bu özelliğin
tablolarını siler, devamsızlık verisine dokunmaz).
Güvenlik testi: `supabase/tests/rls_tests.sql` — SQL Editor'de çalıştırılır,
sonucu kırmızı kutuda rapor olarak basar ve hiçbir şey yazmaz (rollback).

### Uygulama kapalıyken bildirim (web push)

- `app/api/cron/notify/route.ts` + `vercel.json` (her gün 06:00 UTC = 09:00 TR).
- **Kullanıcının Vercel'de yapması gereken (henüz yapılmadı):** Production
  ortam değişkenleri `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` + Redeploy.
- VAPID anahtarları üretildi: `...\Masaüstü\GMT\vapid-anahtarlari.json`
  (repo dışında). Gizli anahtarı ekrana yazma.
- Yerelde test: `CRON_SECRET=x npm run dev` → yetkisiz 401, eksik ortam
  değişkeninde 500 + açıklama. Gerçek gönderim yalnızca canlıda denenebilir.
- iPhone'da push için uygulamanın ana ekrana eklenmiş olması gerekir.

## Bağlantılar ve Panolar (sosyal bölüm)

Alt çubuğun ortasındaki GMT logosu bu merkezi açar (`components/hub/`).
Üç sekme: Bağlantılar · Panolar · Bana Atananlar. Misafir kullanıcı giriş
ekranı görür.

**Değişmez kural:** Bu bölüm devamsızlık verisine ERİŞMEZ. `semesters`,
`courses`, `absence_records` politikaları hiç değiştirilmedi. Panonun bir
derse bağlanması bile kişiye özeldir (`board_course_links`), diğer üyeler
ders adını görmez.

### Bağlantı kurma
- Herkesin tahmin edilemez bir kodu var: `GMT-XXXX-XXXX`, 31 harflik
  alfabe (0/O/1/I/L yok), sunucuda üretilir (`ensure_my_code`).
- Kodla kişi bulma YALNIZCA `lookup_code()` üzerinden; istemci `profiles`
  tablosunu tarayamaz. Hız sınırı: 10 dakikada 10 deneme (`code_lookups`).
- Sorgu sonucu sadece ad + fotoğraf döner. Bölüm/sınıf bağlantı kabul
  edilince görünür.
- Genel arama / kullanıcı listesi / öneri YOK — bilinçli.
- QR'ın içinde kod değil DAVET LİNKİ var (`/?c=GMT-...`): iPhone'da
  uygulama içi okuyucu (BarcodeDetector) olmadığı için kamera uygulaması
  linki açabilsin diye.
- Engellenen kişi istek gönderemez ve engellendiğini ANLAMAZ ("bulunamadı").

### Panolar
- workspace → board → card. Roller: owner > admin > member.
- Yetki tek yerde: `board_role()` (alan rolü ile pano rolünün güçlüsü).
  Politikalar `can_see_board` / `can_edit_cards` / `can_manage_board`.
- Kart silme ve üye yönetimi yönetici işi; üye kart ekler/günceller.
- Aktivite akışı TETİKLEYİCİYLE yazılır (`card_activity_trigger`), istemci
  sahte satır yazamaz.
- Davet kodları süreli ve iptal edilebilir (`board_invites`, `PANO-...`).

### Senkron (lib/social/boards.ts — ayrı motor)
- Dexie v4: `workspaces`, `boards`, `cards`, `boardQueue`.
- Kart GÜNCELLEMELERİNDE yalnızca DEĞİŞEN ALANLAR gönderilir (alan bazında
  son yazan kazanır) — iki kişi aynı kartın farklı alanlarını değiştirince
  ikisi de korunur. Tarayıcıda doğrulandı (sadece `due_date` gitti).
- `pullBoards()` sunucuda olmayan satırları yerelden siler AMA kuyrukta
  bekleyen kartlara dokunmaz (yoksa çevrimdışı eklenen kart kaybolurdu).
- Profil/kod/bağlantı işlemleri bilerek çevrimiçi; panolar çevrimdışı çalışır.

## Çalışma düzeni (kullanıcının beklentisi)

1. Değişikliği yap, `npx tsc --noEmit` ve `npx next build` ile doğrula.
2. **Tarayıcıda gerçekten çalıştır**: `npm run dev -- -p <boş port>` (3140+
   kullanıldı), sonra tarayıcı panelinden aç, telefon boyutunda (375×812)
   dene, ölçüm/ekran görüntüsüyle kanıtla. Varsayımla "çalışıyor" deme.
3. Kullanıcı "yayına al" demeden **push etme**. "localde yapalım bakalım"
   dediğinde commit bile atmadan bırak, beğenirse commit + push.
4. Commit mesajları Türkçe: ne değişti + **neden**. Sonuna
   `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
5. Kod içi yorumlar Türkçe ve "neden"i anlatır; bariz olanı tekrar etmez.
6. Her yayından sonra kullanıcıya **geri dönüş noktası** (önceki commit) söyle.

## Tuzaklar (yaşananlar)

- **React hook'ları erken çıkıştan önce olmalı.** `App.tsx` içinde
  `if (!ready || !settings) return ...` var; hook'u bunun ALTINA koymak
  uygulamayı komple çökertti ("Rendered more hooks…").
- **Tarayıcı paneli bazen geçiş animasyonunun ilk karesini yakalar** →
  ekran boş görünür. 1 sn bekleyip tekrar fotoğrafla.
- **Servis çalışanı geliştirmede eski paketi sunabilir.** Değişiklik
  görünmüyorsa: `getRegistrations().unregister()` + `caches.delete`.
- **PWA adı OS'te kuruluyken önbelleğe alınır.** manifest değişince
  kullanıcının ikonu silip yeniden eklemesi (ve site verisini temizlemesi)
  gerekir.
- `public/` altındaki sabit dosyalar (ikon/logo) değişirse `sw.js` içindeki
  `CACHE = "gmt-cache-vN"` sürümünü artır.
- Dexie şeması değişirse sürüm ekle; **var olan kullanıcının verisi
  kaybolmamalı** (gerçek bir v2 veritabanı kurup yükseltmeyi test et).
- Uygulama içi bildirim kontrolü yalnızca **uygulama açıkken** çalışır.
  Kapalıyken bildirim sunucudaki günlük işe (web push) bağlı; Vercel ortam
  değişkenleri ayarlanmadan o da çalışmaz. Kullanıcıya bunu doğru anlat.

## Tasarım kuralları

- Marka turuncusu `--accent`. Açık tema sıcak krem; koyu tema **"Arduvaz"**
  (hafif yeşilimsi koyu gri).
- **Koyu temada turuncu yalnızca yazı/ikon/birincil butonda.** Yüzey ve
  kenarlıklar nötr; renkli gölge yok. (Aksi "neon/vibe-code" görünüyor —
  kullanıcı bunu açıkça reddetti.)
- İlerleme çubukları koyu temada yarıya kadar sakin gri-adaçayı, sonra kum →
  kehribar → kiremit (`lib/color.ts`).
- Ekleme butonları 48px, ortada, listenin altında; ekranda serbest gezen
  (fixed) buton yok. Konum, alt çubuktaki logonun ölçülen yüksekliğine göre
  hesaplanır (`--logo-top` + `--fab-gap`).
- Butonlarda "+" öneki yok ("Ders Ekle", "Proje Ekle").
- Sekmeye basınca simge dairesi dolup yukarı yaylanır; `prefers-reduced-motion`
  varsa animasyon kapanır.

## Sıradaki fikirler (kullanıcıyla konuşuldu)

Yapıldı: projeler/program dosyaları yedekleme (003 bekliyor), web push,
ders renkleri, tema/dil senkronu.

Bağlantılar ve Panolar (aşama 1a–2f) `feature/connections-boards` dalında
yazıldı; canlıya alınması için SQL'in çalıştırılması gerekiyor.

Kalanlar:
1. Elle haftalık ders programı → "bugünkü derslerin" + tek dokunuşla
   devamsızlık + ders öncesi hatırlatma.
2. Devamsızlık penceresinde 2/3 saat kısayolu (ya da derse varsayılan süre).
3. "Bu hızla gidersen sınırı X'te doldurursun" tahmini.
4. Excel'den toplu ders ekleme (okuyucu `lib/sheet/xlsx.ts` hazır).
5. Misafir için yedek al / geri yükle.
