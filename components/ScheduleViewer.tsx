"use client";

import * as React from "react";
import { CloseIcon } from "./icons";

// Tam ekran ders programı görüntüleyici.
//
// Uygulamanın viewport'u `userScalable: false` olduğu için tarayıcının kendi
// iki parmakla yakınlaştırması çalışmıyor; tablo fotoğrafındaki küçük yazıları
// okuyabilmek için yakınlaştırmayı burada kendimiz yapıyoruz:
//   - iki parmak: parmakların ortasına doğru yakınlaştır/uzaklaştır
//   - tek parmak (yakınken): kaydır
//   - çift dokunma: dokunulan noktaya 2.5x ↔ 1x
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

type Pt = { x: number; y: number };

export default function ScheduleViewer({
  src,
  hint,
  onClose,
}: {
  src: string;
  hint: string;
  onClose: () => void;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const pointers = React.useRef(new Map<number, Pt>());
  // Hareketin başladığı andaki durum; her karede baştan hesaplamak birikimli
  // yuvarlama hatalarını önler.
  const gesture = React.useRef<{ s: number; x: number; y: number; mid: Pt; dist: number } | null>(null);
  const lastTap = React.useRef<{ t: number; p: Pt } | null>(null);
  const moved = React.useRef(false);

  // Kaydırmayı resmin kenarları içinde tut — resim ekrandan kaçmasın.
  const clamp = React.useCallback((s: number, x: number, y: number) => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return { s, x, y };
    const maxX = Math.max(0, (img.clientWidth * s - box.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * s - box.clientHeight) / 2);
    return { s, x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  }, []);

  // Kutunun merkezine göre koordinat (transform-origin merkezde).
  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        ...v,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      };
    } else if (pts.length === 1) {
      gesture.current = { ...v, mid: pts[0], dist: 1 };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* bazı tarayıcılarda capture desteklenmeyebilir — hareket yine çalışır */
    }
    pointers.current.set(e.pointerId, rel(e));
    if (pointers.current.size === 1) moved.current = false;
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, rel(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.s * (dist / g.dist)));
      // Parmakların altındaki nokta parmaklarla birlikte kalsın.
      const k = s / g.s;
      const x = mid.x - (g.mid.x - g.x) * k;
      const y = mid.y - (g.mid.y - g.y) * k;
      moved.current = true;
      setView(clamp(s, x, y));
    } else if (pts.length === 1 && g.s > 1) {
      const p = pts[0];
      const dx = p.x - g.mid.x;
      const dy = p.y - g.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      setView(clamp(g.s, g.x + dx, g.y + dy));
    } else if (pts.length === 1) {
      const p = pts[0];
      if (Math.abs(p.x - g.mid.x) + Math.abs(p.y - g.mid.y) > 8) moved.current = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const wasTap = pointers.current.size === 0 && !moved.current && p;
    startGesture();
    if (!wasTap) return;

    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 300 && Math.hypot(prev.p.x - p.x, prev.p.y - p.y) < 30) {
      lastTap.current = null;
      const v = viewRef.current;
      if (v.s > 1.05) {
        setView({ s: 1, x: 0, y: 0 });
      } else {
        const k = DOUBLE_TAP_SCALE / v.s;
        setView(clamp(DOUBLE_TAP_SCALE, p.x - (p.x - v.x) * k, p.y - (p.y - v.y) * k));
      }
    } else {
      lastTap.current = { t: now, p };
    }
  };

  // Masaüstünde fare tekerleğiyle yakınlaştırma.
  const onWheel = (e: React.WheelEvent) => {
    const p = rel(e);
    const v = viewRef.current;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = s / v.s;
    setView(s === 1 ? { s: 1, x: 0, y: 0 } : clamp(s, p.x - (p.x - v.x) * k, p.y - (p.y - v.y) * k));
  };

  // Ekran döndürülünce/boyut değişince kaydırmayı yeniden sınırla.
  React.useEffect(() => {
    const onResize = () => setView((v) => clamp(v.s, v.x, v.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const animating = pointers.current.size === 0;

  return (
    <div className="sv-root" role="dialog" aria-modal="true">
      <div
        ref={boxRef}
        className="sv-box"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          className="sv-img"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            transition: animating ? "transform 0.18s ease-out" : "none",
          }}
        />
      </div>
      <button className="sv-close" onClick={onClose} aria-label="close">
        <CloseIcon />
      </button>
      {view.s === 1 && <div className="sv-hint">{hint}</div>}
    </div>
  );
}
