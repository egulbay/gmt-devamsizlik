// Absence bar color: green → red gradient based on fill ratio.
// Uses oklch interpolation (hue drifts from 145 toward red as ratio grows),
// matching the prototype's ratioColor().
export function ratioColor(r: number, dark: boolean): string {
  const cl = Math.min(1, Math.max(0, r));
  const hue = 145 - cl * 120;
  // Koyu temada doygunluk (chroma) daha düşük: koyu zeminde 0.15+ chroma
  // çubukları neon gibi parlatıyordu.
  const L = dark ? 0.66 - cl * 0.05 : 0.6;
  const C = dark ? 0.115 + cl * 0.02 : 0.15;
  return `oklch(${L} ${C} ${hue.toFixed(0)})`;
}
