// Salt-okunur XLSX/CSV çözümleyici.
//
// Neden kendi kodumuz: en yaygın kütüphane olan `xlsx`in npm'deki son sürümü
// (0.18.5) yamanmamış bir prototype-pollution açığı taşıyor ve yamalı sürüm
// npm'de yayınlanmıyor; `exceljs` ise tarayıcı paketine ~1 MB ekliyor. Biz
// dosyayı yalnızca GÖSTERMEK için okuyoruz: bir .xlsx zaten zip'lenmiş XML
// olduğundan, unzip (fflate) + küçük bir XML taraması yetiyor.
//
// Desteklenen: sayfa adları ve sırası, paylaşılan/satır-içi metinler, sayılar,
// formüllerin son hesaplanmış değeri, birleştirilmiş hücreler, tarih/saat
// biçimleri. Desteklenmeyen (gösterimde gerekmiyor): stiller, grafikler,
// koşullu biçimlendirme, formüllerin yeniden hesaplanması.
import { unzipSync, strFromU8 } from "fflate";

export interface SheetMerge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface ParsedSheet {
  name: string;
  rows: string[][];
  merges: SheetMerge[];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

export class SheetParseError extends Error {}

// "B12" → { row: 11, col: 1 } (0 tabanlı)
function refToRowCol(ref: string): { row: number; col: number } {
  let col = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    col = col * 26 + (code - 64);
  }
  return { row: parseInt(ref.slice(i), 10) - 1, col: col - 1 };
}

// XML metin kaçışlarını çöz. Sadece görüntüleyeceğimiz için bu beş yeterli.
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

// <t> içeriklerini sırayla topla (paylaşılan metin tablosu ve inlineStr için).
function collectText(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] ? unescapeXml(m[1]) : "";
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  // Her <si> bir metin; içinde biçim parçaları (<r><t>..</t></r>) olabilir.
  const re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ? collectText(m[1]) : "");
  return out;
}

// Excel tarih seri numarasını okunur metne çevirir. 1900 sistemi; Excel'in
// bilinen "1900 artık yıl" hatası yüzünden 60'tan büyük değerlerde bir gün
// geri alınır.
function serialToDisplay(n: number, isTimeOnly: boolean): string {
  const days = Math.floor(n);
  const frac = n - days;
  const ms = Math.round(frac * 86400) * 1000;
  const hh = String(Math.floor(ms / 3600000) % 24).padStart(2, "0");
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  if (isTimeOnly) return `${hh}:${mm}`;
  const epoch = Date.UTC(1899, 11, 31);
  const d = new Date(epoch + (days > 60 ? days - 1 : days) * 86400000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  return frac > 0 ? `${date} ${hh}:${mm}` : date;
}

// Yerleşik tarih/saat biçim numaraları (14-22, 45-47) + özel biçimlerde
// tarih/saat kodu geçenler.
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function buildDateFormatMap(stylesXml: string | null): {
  isDate: (styleIdx: number) => boolean;
  isTime: (styleIdx: number) => boolean;
} {
  if (!stylesXml) return { isDate: () => false, isTime: () => false };
  const custom = new Map<number, string>();
  const reFmt = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = reFmt.exec(stylesXml))) custom.set(Number(m[1]), unescapeXml(m[2]));

  // cellXfs: hücrelerin gerçekten kullandığı biçim listesi.
  const xfsBlock = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  // Sıra önemli: hücrenin s="N" değeri bu listedeki N. kayda karşılık gelir.
  // numFmtId taşımayan bir <xf> atlanırsa sonraki tüm eşleşmeler kayardı.
  const fmtIds: number[] = [];
  const reXf = /<xf\b([^>]*)>/g;
  while ((m = reXf.exec(xfsBlock))) {
    fmtIds.push(Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0));
  }

  const codeOf = (styleIdx: number): { date: boolean; time: boolean } => {
    const id = fmtIds[styleIdx];
    if (id == null) return { date: false, time: false };
    const code = custom.get(id);
    if (code) {
      const stripped = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
      // DİKKAT: Excel biçim kodunda "m" bağlama göre AY ya da DAKİKA demek
      // ("hh:mm" dakikadır). Ay saymak için yalnızca "y"/"d" ve ay adı veren
      // "mmm+" kabul ediliyor; yoksa saat biçimleri tarih sanılıyordu.
      const hasDate = /[yd]/i.test(stripped) || /m{3,}/i.test(stripped);
      const hasTime = /[hs]/i.test(stripped);
      return { date: hasDate || hasTime, time: hasTime && !hasDate };
    }
    if (!BUILTIN_DATE.has(id)) return { date: false, time: false };
    // 14-17: tarih · 18-21 ve 45-47: saat · 22: tarih + saat
    const timeOnly = (id >= 18 && id <= 21) || (id >= 45 && id <= 47);
    return { date: true, time: timeOnly };
  };
  return { isDate: (i) => codeOf(i).date, isTime: (i) => codeOf(i).time };
}

function parseSheet(xml: string, shared: string[], fmt: ReturnType<typeof buildDateFormatMap>): {
  rows: string[][];
  merges: SheetMerge[];
} {
  const rows: string[][] = [];
  const setCell = (row: number, col: number, val: string) => {
    if (row < 0 || col < 0) return;
    while (rows.length <= row) rows.push([]);
    const r = rows[row];
    while (r.length <= col) r.push("");
    r[col] = val;
  };

  // Kendi kendine kapanan boş hücre (<c r="D1"/>) ÖNCE denenmeli. Tek kalıpta
  // "/> ya da >…</c>" yazılınca düzenli ifade geri izleyip boş hücreyi açık
  // hücre sanıyor ve BİR SONRAKİ hücrenin içeriğini yutuyordu: o hücrenin
  // değeri kayboluyor, ham değeri de boş hücreye yazılıyordu.
  const reCell = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = reCell.exec(xml))) {
    const attrs = m[1] ?? m[2];
    const body = m[3] ?? "";
    const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
    if (!ref) continue;
    const { row, col } = refToRowCol(ref);
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";
    const styleIdx = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? NaN);

    let value = "";
    if (type === "s") {
      const idx = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? NaN);
      value = Number.isFinite(idx) ? shared[idx] ?? "" : "";
    } else if (type === "inlineStr") {
      value = collectText(body);
    } else if (type === "str") {
      // Formülün metin sonucu
      value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    } else if (type === "b") {
      value = body.includes("<v>1</v>") ? "DOĞRU" : "YANLIŞ";
    } else if (type === "e") {
      value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    } else {
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (raw != null && raw !== "") {
        const num = Number(raw);
        if (Number.isFinite(num) && Number.isFinite(styleIdx) && fmt.isDate(styleIdx)) {
          value = serialToDisplay(num, fmt.isTime(styleIdx));
        } else {
          value = raw;
        }
      }
    }
    if (value !== "") setCell(row, col, value);
  }

  const merges: SheetMerge[] = [];
  const reMerge = /<mergeCell[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g;
  while ((m = reMerge.exec(xml))) {
    const a = refToRowCol(m[1]);
    const b = refToRowCol(m[2]);
    merges.push({ r1: a.row, c1: a.col, r2: b.row, c2: b.col });
  }
  return { rows, merges };
}

// CSV/TSV: tırnaklı alanlar ve alan içi satır sonu dahil.
export function parseDelimited(text: string, delimiter?: string): ParsedSheet {
  const d = delimiter ?? (text.split("\n")[0].includes("\t") ? "\t" : text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return { name: "CSV", rows, merges: [] };
}

export async function parseWorkbook(file: Blob, fileName: string): Promise<ParsedWorkbook> {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    return { sheets: [parseDelimited(await file.text())] };
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    // .xls (eski ikili biçim) veya bozuk dosya: zip bile değil.
    throw new SheetParseError("unzip");
  }
  const get = (path: string): string | null => {
    const key = Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase());
    return key ? strFromU8(files[key]) : null;
  };

  const wb = get("xl/workbook.xml");
  if (!wb) throw new SheetParseError("no-workbook");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const relTarget = new Map<string, string>();
  let m: RegExpExecArray | null;
  const reRel = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((m = reRel.exec(rels))) relTarget.set(m[1], m[2].replace(/^\/?xl\//, "").replace(/^\//, ""));

  const shared = parseSharedStrings(get("xl/sharedStrings.xml") ?? "");
  const fmt = buildDateFormatMap(get("xl/styles.xml"));

  const sheets: ParsedSheet[] = [];
  const reSheet = /<sheet\b([^>]*)\/?>/g;
  let idx = 0;
  while ((m = reSheet.exec(wb))) {
    const attrs = m[1];
    idx++;
    const name = unescapeXml(attrs.match(/\bname="([^"]*)"/)?.[1] ?? `Sayfa ${idx}`);
    const rid = attrs.match(/r:id="([^"]+)"/)?.[1];
    const target = (rid && relTarget.get(rid)) || `worksheets/sheet${idx}.xml`;
    const xml = get(`xl/${target}`);
    if (!xml) continue;
    const { rows, merges } = parseSheet(xml, shared, fmt);
    sheets.push({ name, rows, merges });
  }
  if (!sheets.length) throw new SheetParseError("no-sheets");
  return { sheets };
}
