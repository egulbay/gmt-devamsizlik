// Dokunsal geri bildirim (titreşim).
//
// Uygulamada iki yerde kullanılıyor: karta uzun basınca açılan düzenleme modu
// ve sınıf seçicideki "tık tık" geçişleri. Tek bir yardımcı olsun diye burada
// toplandı — daha önce bu mantık CourseCard içine gömülüydü.
//
// Vibration API her yerde yok (özellikle iOS Safari hiç desteklemez, bazı
// tarayıcılar da kullanıcı etkileşimi olmadan yok sayar). Bu yüzden her çağrı
// özellik kontrolü + try/catch ile sarılı: desteklenmeyen yerde sessizce
// hiçbir şey yapmaz, asla hata fırlatmaz.
export function haptic(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* desteklenmiyor — sessizce geç */
  }
}

// Uzun basış / mod değişimi gibi "bir şey oldu" geri bildirimi.
export const HAPTIC_PRESS = 15;
// Seçici tekerleğinde her kademe değişiminde verilen kısa "tık".
export const HAPTIC_TICK = 8;
