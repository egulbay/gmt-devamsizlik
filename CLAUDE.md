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
| Dersler, devamsızlık kayıtları, dönemler | Evet |
| Projeler + yapılacaklar + hatırlatma eşikleri | Evet (migration 002'den sonra) |
| Ders programı fotoğrafı / Excel dosyası | **Hayır — yalnızca cihazda** |
| Tema, dil, tanıtım gösterildi bilgisi, avatar adresi | Hayır (cihaza özel) |

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
- Bildirimler yalnızca **uygulama açıkken** değerlendiriliyor; telefona
  kendiliğinden düşmüyor (sunucu tarafı yok). Kullanıcıya bunu doğru anlat.

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

1. Ders programı dosyalarının buluta yedeklenmesi (Supabase Storage).
2. Bildirimlerin uygulama kapalıyken de gelmesi (sunucu + web push).
3. Elle haftalık ders programı → "bugünkü derslerin" + tek dokunuşla
   devamsızlık + ders öncesi hatırlatma.
4. Küçükler: devamsızlık penceresinde 2/3 saat kısayolu, misafir için yedek
   al/geri yükle, derslere renk, "bu hızla gidersen sınırı X'te doldurursun"
   tahmini, Excel'den toplu ders ekleme (okuyucu `lib/sheet/xlsx.ts` hazır).
