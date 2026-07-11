import * as React from "react";
import { MONTHS, WEEKDAYS } from "@/lib/i18n";
import type { AbsenceRecord, Lang } from "@/lib/types";

function pad2(n: number) {
  return n < 10 ? "0" + n : "" + n;
}
function ymd(y: number, m: number, d: number) {
  return y + "-" + pad2(m + 1) + "-" + pad2(d);
}

interface Props {
  year: number;
  month: number; // 0-11
  lang: Lang;
  recordsByDate: Record<string, AbsenceRecord>;
  onPrev: () => void;
  onNext: () => void;
  onTapDay: (dateKey: string, existing?: AbsenceRecord) => void;
}

export function Calendar({ year, month, lang, recordsByDate, onPrev, onNext, onTapDay }: Props) {
  const today = new Date();
  const todayKey = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push(<button key={i} className="cal-cell blank" disabled aria-hidden />);
      continue;
    }
    const key = ymd(year, month, dayNum);
    const rec = recordsByDate[key];
    const isFuture = key > todayKey;
    const cls = ["cal-cell", rec ? "marked" : "", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
    cells.push(
      <button
        key={i}
        className={cls}
        disabled={isFuture}
        onClick={() => onTapDay(key, rec)}
        title={rec ? `${rec.hours} ${lang === "tr" ? "saat" : "hours"}` : undefined}
      >
        {dayNum}
      </button>
    );
  }

  return (
    <div className="stack">
      <div className="cal-header">
        <button className="icon-btn small" onClick={onPrev} aria-label="prev">‹</button>
        <span className="fw7 fs14">{MONTHS[lang][month]} {year}</span>
        <button className="icon-btn small" onClick={onNext} aria-label="next">›</button>
      </div>
      <div className="cal-weekdays">
        {WEEKDAYS[lang].map((w) => (
          <span key={w} className="fs11 sub tc">{w}</span>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>
    </div>
  );
}
