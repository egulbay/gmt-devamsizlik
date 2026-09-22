"use client";

import { useEffect, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";

// Uygulama içi QR okuyucu. Tarayıcının KENDİ çözücüsünü (BarcodeDetector)
// kullanır: ek kütüphane yok, çözme işini telefon yapar. Desteklemeyen
// tarayıcılarda (bugün iPhone/Safari) bu ekran hiç açılmaz — orada kullanıcı
// telefonun kamera uygulamasıyla QR'ı okutup linke dokunur, ya da kodu elle
// yazar. Bu yüzden QR'ın içinde kod değil LİNK var.
export function qrScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

type Detector = {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export default function QrScanner({
  t,
  onResult,
  onClose,
}: {
  t: Dict;
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Arka kamera: QR okutmak için doğru olan bu.
          video: { facingMode: "environment" },
        });
        if (stopped) return;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector })
          .BarcodeDetector;
        const detector = new Ctor({ formats: ["qr_code"] });
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found.length && found[0].rawValue) {
              onResult(found[0].rawValue);
              return;
            }
          } catch {
            /* tek kare okunamadıysa önemli değil, devam */
          }
          raf = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch {
        // İzin verilmedi ya da kamera yok.
        setError(t.hubScanDenied);
      }
    };
    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onResult, t.hubScanDenied]);

  return (
    <div className="qr-scan" role="dialog" aria-label={t.hubScan}>
      <div className="qr-scan-top">
        <button className="icon-btn small" onClick={onClose} aria-label={t.hubCancel}>‹</button>
        <div className="fw7 fs14">{t.hubScan}</div>
      </div>
      {error ? (
        <div className="qr-scan-msg fs14">{error}</div>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="qr-scan-video" playsInline muted />
          <div className="qr-scan-frame" aria-hidden="true" />
          <div className="qr-scan-msg fs13 sub">{t.hubScanHint}</div>
        </>
      )}
    </div>
  );
}
