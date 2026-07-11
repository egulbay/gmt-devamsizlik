# GMT Devamsızlık Takip

Üniversite öğrencilerinin ders devamsızlıklarını **ders saati** cinsinden takip
etmesi için geliştirilen **offline-first PWA**. "Geleceğin Meslekleri Topluluğu
(GMT)", Kırıkkale Üniversitesi için.

Next.js + TypeScript, IndexedDB (Dexie) üzerinde yerel veri, opsiyonel Supabase
bulut senkronizasyonu, Web Push bildirimleri. Play Store / App Store gerekmeden
tarayıcıdan **"ana ekrana ekle"** ile kurulur.

## Hızlı başlangıç

```bash
npm install
npm run dev
```

http://localhost:3000 adresini açın. Üretim derlemesi:

```bash
npm run build && npm start
```

Uygulama **Supabase olmadan da tam çalışır** (yalnızca-yerel / misafir modu).
Bulut senkronizasyonu ve Google ile giriş isteğe bağlıdır.

## Özellikler

- **Giriş:** Google ile giriş (Supabase) veya misafir girişi (ad-soyad ile).
- **Misafir modu:** Veriler yalnızca cihazda; net uyarı banner'ı + "Hesap Oluştur"
  hatırlatması. Misafirken eklenen veriler hesap açılınca otomatik migrate edilir.
- **Derslerim:** Özet kartı ("X dersin sınıra yakın"), doluluk oranına göre
  yeşil→kırmızı kademeli bar (oklch), sınıra yaklaşınca/aşınca uyarı ikonu.
  4+ derste **arama** ve **sıralama** (eklenme / sınıra yakın / isim).
- **Ders ekleme/düzenleme/silme:** Devamsızlık hakkı **ders saati** cinsinden.
- **Ders detayı:** Kalan/kullanılan saat, **takvim** (devamsız gün kırmızı,
  hareketli bar/stepper ile saat girişi), kayıt listesi, "Kayıtları Sil".
- **Dönem/sömestr yönetimi:** Yeni dönem başlatınca eskiler silinmez, arşivlenir;
  "Geçmiş Dönemler" sekmesinden erişilir.
- **Bildirimler:** Kalan hak 2 saate düşünce ilk uyarı, sonrasında sınır
  aşılmadıkça haftalık hatırlatma, sınıra ulaşınca son uyarı (sonra durur).
- **Senkronizasyon durumu:** "senkronize edildi / bekliyor / ediliyor / çevrimdışı"
  göstergesi (hesaplı kullanıcılarda). Misafirde yerine yerel-veri banner'ı.
- **Dışa aktarma/paylaşma:** Ders veya tüm dersler için metin özeti (Web Share /
  pano) ya da yazdır→PDF.
- **Profili Sıfırla:** Onay ekranıyla tüm verileri kalıcı siler.
- **TR/EN dil** ve **açık/koyu tema** her ekranda erişilebilir.

## Mimari (offline-first)

- Her yazma **önce IndexedDB'ye** (Dexie) yapılır, UI anında güncellenir.
- `lib/db/repo.ts` her yazmada bir **sync kuyruğuna** (`syncQueue`) kayıt bırakır.
- `lib/sync/syncEngine.ts` internet varken kuyruğu Supabase'e gönderir; yokken
  bekletir, Service Worker **Background Sync** ile bağlantı gelince tetiklenir.
- Çakışma yönetimi: **Last-Write-Wins** — her kayıtta `updatedAt` + `clientId`.
- **localStorage kullanılmaz;** tüm yerel veri IndexedDB üzerindedir.

> Not: Spesifikasyon RxDB'yi önceliklendirip Dexie'ye açıkça izin veriyordu.
> Güvenilir ve öngörülebilir bir senkronizasyon için yerel katman **Dexie +
> özel sync kuyruğu (last-write-wins)** ile kuruldu; mimari kurallarının tamamı
> (offline-first yazma, kuyruk, Background Sync, LWW, localStorage yasağı)
> karşılanıyor.

## Bulut senkronizasyonu (opsiyonel)

1. [supabase.com](https://supabase.com) üzerinde ücretsiz proje açın.
2. **SQL Editor** → `supabase/schema.sql` içeriğini çalıştırın (tablolar + RLS).
3. **Authentication → Providers → Google**'ı etkinleştirin, OAuth istemci
   bilgilerini girin; Redirect URL olarak uygulamanın origin'ini ekleyin.
4. `.env.local.example` dosyasını `.env.local` olarak kopyalayıp doldurun:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Bu değerler yoksa Google butonu kullanıcıyı yerel moda yönlendirir.

## Bildirimler (Web Push)

- Uygulama açıkken eşik uyarıları yerel bildirim + uygulama içi toast olarak
  çalışır. Gerçek arka plan push için `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ve bir push
  sunucusu gerekir.
- **iOS:** PWA bildirimleri yalnızca uygulama **ana ekrana eklendikten** sonra ve
  kullanıcı izniyle çalışır.

## PWA / Kurulum

- `public/manifest.webmanifest` + `public/sw.js` (app-shell cache, Background
  Sync, push). Service worker uygulama açılışında kaydedilir.
- Android/iOS: tarayıcı menüsü → **"Ana ekrana ekle"**.

## Dağıtım

- **Vercel:** repoyu bağlayın, env değişkenlerini girin.
- **GitHub Pages / statik host:** `next.config.mjs` içindeki `output: "export"`
  satırını açın, `npm run build` sonrası `out/` klasörünü yayınlayın.

## Proje yapısı

```
app/            layout, global stil, sayfa (App'i client-only yükler)
components/     App.tsx (tüm ekranlar), Calendar, icons
lib/
  db/           dexie.ts (şema), repo.ts (CRUD + sync kuyruğu)
  sync/         supabaseClient.ts, syncEngine.ts (LWW + Background Sync)
  i18n.ts       TR/EN sözlük
  color.ts      oklch bar rengi
  notifications.ts  eşik bildirim mantığı
  export.ts     metin/PDF özet + paylaşım
public/         manifest, sw.js, ikonlar (GMT logo)
supabase/       schema.sql (tablolar + RLS)
```
