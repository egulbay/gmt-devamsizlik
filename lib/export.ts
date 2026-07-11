import { MONTHS, tf } from "./i18n";
import type { Course, AbsenceRecord, Lang } from "./types";

function fmtDate(date: string, lang: Lang): string {
  const d = new Date(date + "T00:00:00");
  return `${d.getDate()} ${MONTHS[lang][d.getMonth()]} ${d.getFullYear()}`;
}

export interface CourseExport {
  course: Course;
  records: AbsenceRecord[];
}

// Build a plain-text summary suitable for sharing with an instructor/advisor.
export function buildTextSummary(items: CourseExport[], lang: Lang, userName?: string | null): string {
  const t = tf(lang);
  const lines: string[] = [];
  lines.push(`GMT — ${t.summaryTitle}`);
  if (userName) lines.push(userName);
  lines.push(new Date().toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US"));
  lines.push("");

  for (const { course, records } of items) {
    const used = records.reduce((a, r) => a + r.hours, 0);
    const remaining = course.totalHours - used;
    lines.push(`— ${course.name} —`);
    lines.push(`${t.used}: ${used} ${t.saUnit} / ${course.totalHours} ${t.saUnit}`);
    lines.push(`${t.remaining}: ${remaining <= 0 ? t.noneLeft : `${remaining} ${t.saUnit}`}`);
    if (records.length) {
      const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
      for (const r of sorted) {
        lines.push(`   • ${fmtDate(r.date, lang)} — ${r.hours} ${t.saUnit}`);
      }
    } else {
      lines.push(`   ${t.noRecords}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// Share via Web Share API, or fall back to clipboard.
export async function shareText(text: string, title: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch {
    // user cancelled or share failed → try clipboard
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

// Lightweight PDF via the browser print dialog (no external dependency).
// Opens a print window with a clean summary layout; the user can "Save as PDF".
export function printSummary(items: CourseExport[], lang: Lang, userName?: string | null) {
  const t = tf(lang);
  const rowsHtml = items
    .map(({ course, records }) => {
      const used = records.reduce((a, r) => a + r.hours, 0);
      const remaining = course.totalHours - used;
      const recRows = [...records]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => `<tr><td>${fmtDate(r.date, lang)}</td><td style="text-align:right">${r.hours} ${t.saUnit}</td></tr>`)
        .join("");
      return `
        <section>
          <h2>${escapeHtml(course.name)}</h2>
          <p><strong>${t.used}:</strong> ${used} ${t.saUnit} / ${course.totalHours} ${t.saUnit}
             &nbsp;·&nbsp; <strong>${t.remaining}:</strong> ${remaining <= 0 ? t.noneLeft : `${remaining} ${t.saUnit}`}</p>
          <table>${recRows || `<tr><td>${t.noRecords}</td><td></td></tr>`}</table>
        </section>`;
    })
    .join("");

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>GMT — ${t.summaryTitle}</title>
    <style>
      body{font-family:system-ui,-apple-system,sans-serif;color:#1b1512;padding:32px;max-width:640px;margin:auto}
      h1{color:#ff5a1f;font-size:22px;margin:0 0 4px}
      .meta{color:#8a8078;font-size:13px;margin-bottom:20px}
      section{border:1px solid #eee;border-radius:12px;padding:14px 16px;margin-bottom:14px}
      h2{font-size:16px;margin:0 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      td{padding:4px 0;border-bottom:1px solid #f2f2f2}
    </style></head><body>
    <h1>GMT — ${t.summaryTitle}</h1>
    <div class="meta">${userName ? escapeHtml(userName) + " · " : ""}${new Date().toLocaleDateString(
    lang === "tr" ? "tr-TR" : "en-US"
  )}</div>
    ${rowsHtml}
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
