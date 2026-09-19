// Absence bar color, based on fill ratio (0 = no absences, 1 = at the limit).
//
// Açık tema: yeşil → kırmızı oklch geçişi (prototipteki ratioColor()).
//
// Koyu tema ("Arduvaz", kullanıcıyla seçilen C karışımı): yarıya kadar sakin,
// neredeyse nötr bir gri-adaçayı; yarıdan sonra kum → kiremit toprak tonlarına
// yumuşakça ısınır. Böylece renk yalnızca dikkat edilmesi gereken derslerde
// görünür; eski doygun turuncu/kırmızı çubuklar koyu zeminde sırıtıyordu.
type Oklch = [number, number, number];
const SAGE_GREY: Oklch = [0.8, 0.03, 160];
const SAND: Oklch = [0.78, 0.09, 82];
const AMBER: Oklch = [0.73, 0.1, 60];
const TERRA: Oklch = [0.67, 0.115, 38];

const mix = (a: Oklch, b: Oklch, t: number): string =>
  `oklch(${(a[0] + (b[0] - a[0]) * t).toFixed(3)} ${(a[1] + (b[1] - a[1]) * t).toFixed(3)} ${(a[2] + (b[2] - a[2]) * t).toFixed(0)})`;

export function ratioColor(r: number, dark: boolean): string {
  const cl = Math.min(1, Math.max(0, r));
  if (dark) {
    if (cl < 0.5) return mix(SAGE_GREY, SAGE_GREY, 0);
    const t = (cl - 0.5) / 0.5; // 0..1, yarıdan sınıra
    return t < 0.5 ? mix(SAND, AMBER, t / 0.5) : mix(AMBER, TERRA, (t - 0.5) / 0.5);
  }
  const hue = 145 - cl * 120;
  return `oklch(0.6 0.15 ${hue.toFixed(0)})`;
}
