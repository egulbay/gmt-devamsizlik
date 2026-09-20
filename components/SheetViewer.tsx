"use client";

import * as React from "react";
import { CloseIcon, ShareIcon } from "./icons";
import type { ParsedWorkbook } from "@/lib/sheet/xlsx";

// Excel/CSV ders programını tam ekran tablo olarak gösterir.
//
// Çözümleyici (ve unzip kütüphanesi) yalnızca burada, dosya AÇILDIĞINDA
// yükleniyor (dinamik import): Excel kullanmayan kullanıcı için uygulamanın
// ilk açılışına tek bayt eklemiyor.
//
// Çok büyük dosyalarda telefon kilitlenmesin diye gösterim sınırlanıyor.
const MAX_ROWS = 400;
const MAX_COLS = 40;
const ZOOMS = [11, 13, 15, 18, 22];

export default function SheetViewer({
  blob,
  name,
  strings,
  onClose,
}: {
  blob: Blob;
  name: string;
  strings: {
    loading: string;
    error: string;
    share: string;
    truncated: (rows: number, cols: number) => string;
    empty: string;
  };
  onClose: () => void;
}) {
  const [wb, setWb] = React.useState<ParsedWorkbook | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [zoom, setZoom] = React.useState(1); // ZOOMS dizisindeki konum

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { parseWorkbook } = await import("@/lib/sheet/xlsx");
        const parsed = await parseWorkbook(blob, name);
        if (!cancelled) setWb(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, name]);

  // Telefonun kendi uygulamasında aç / paylaş. Web Share desteklenmiyorsa
  // dosyayı indirir.
  const share = async () => {
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    try {
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch {
      /* kullanıcı vazgeçti ya da paylaşım başarısız — indirmeye düş */
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const sheet = wb?.sheets[active];
  const rows = sheet ? sheet.rows.slice(0, MAX_ROWS) : [];
  const colCount = Math.min(MAX_COLS, rows.reduce((mx, r) => Math.max(mx, r.length), 0));
  const truncated = sheet
    ? { rows: sheet.rows.length > MAX_ROWS, cols: sheet.rows.some((r) => r.length > MAX_COLS) }
    : { rows: false, cols: false };

  // Birleştirilmiş hücreler: sol-üst hücre span alır, kapsananlar çizilmez.
  const { spans, skip } = React.useMemo(() => {
    const spans = new Map<string, { cs: number; rs: number }>();
    const skip = new Set<string>();
    for (const mg of sheet?.merges ?? []) {
      spans.set(`${mg.r1}:${mg.c1}`, { cs: mg.c2 - mg.c1 + 1, rs: mg.r2 - mg.r1 + 1 });
      for (let r = mg.r1; r <= mg.r2; r++) {
        for (let c = mg.c1; c <= mg.c2; c++) {
          if (r !== mg.r1 || c !== mg.c1) skip.add(`${r}:${c}`);
        }
      }
    }
    return { spans, skip };
  }, [sheet]);

  return (
    <div className="sv-root sheet-view" role="dialog" aria-modal="true">
      <div className="shv-bar">
        <span className="shv-name">{name}</span>
        <button className="shv-btn" onClick={() => setZoom((z) => Math.max(0, z - 1))} aria-label="zoom-out" disabled={zoom === 0}>−</button>
        <button className="shv-btn" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} aria-label="zoom-in" disabled={zoom === ZOOMS.length - 1}>+</button>
        <button className="shv-btn" onClick={() => void share()} aria-label="share"><ShareIcon /></button>
        <button className="shv-btn" onClick={onClose} aria-label="close"><CloseIcon /></button>
      </div>

      {wb && wb.sheets.length > 1 && (
        <div className="shv-tabs">
          {wb.sheets.map((s, i) => (
            <button key={i} className={`shv-tab${i === active ? " on" : ""}`} onClick={() => setActive(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="shv-body">
        {!wb && !failed && <div className="shv-msg">{strings.loading}</div>}
        {failed && (
          <div className="shv-msg">
            <div>{strings.error}</div>
            <button className="btn-ghost shv-share-fallback" onClick={() => void share()}>
              <ShareIcon /> {strings.share}
            </button>
          </div>
        )}
        {sheet && rows.length === 0 && <div className="shv-msg">{strings.empty}</div>}
        {sheet && rows.length > 0 && (
          <>
            <table className="shv-table" style={{ fontSize: ZOOMS[zoom] }}>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {Array.from({ length: colCount }, (_, c) => {
                      if (skip.has(`${r}:${c}`)) return null;
                      const sp = spans.get(`${r}:${c}`);
                      return (
                        <td key={c} colSpan={sp?.cs} rowSpan={sp?.rs}>
                          {row[c] ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {(truncated.rows || truncated.cols) && (
              <div className="shv-msg shv-truncated">{strings.truncated(MAX_ROWS, MAX_COLS)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
