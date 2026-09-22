"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

// Davet linkini QR olarak çizer. Kütüphane yalnızca "hangi kare dolu"
// bilgisini veriyor; çizimi biz SVG ile yapıyoruz ki tema renklerine uysun ve
// her ekran boyutunda keskin görünsün (resim değil, vektör).
//
// Düzeltme seviyesi M: telefon ekranından okunurken fazlasıyla yeterli, kare
// sayısını gereksiz artırmaz. QR'ın etrafındaki boşluk (quiet zone) standarda
// göre 4 kare — daha azı bazı okuyucularda okunmuyor.
export default function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const { path, dim } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return { path: d, dim: count + quiet * 2 };
  }, [text]);

  return (
    <svg
      className="qr-svg"
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR"
    >
      {/* Arka plan her zaman beyaz: koyu temada koyu zemine çizilen QR
          okuyucuların çoğu tarafından okunmuyor. */}
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
