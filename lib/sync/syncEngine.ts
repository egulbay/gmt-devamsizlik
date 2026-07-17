import { db } from "../db/dexie";
import { getSettings } from "../db/repo";
import { supabase, isCloudEnabled } from "./supabaseClient";
import type { SyncState, Course, AbsenceRecord, Semester } from "../types";

// Maps our local tables to Supabase table names.
const TABLE_MAP = {
  courses: "courses",
  records: "absence_records",
  semesters: "semesters",
} as const;

type Listener = (state: SyncState) => void;
const listeners = new Set<Listener>();
let currentState: SyncState = "synced";

export function onSyncState(fn: Listener): () => void {
  listeners.add(fn);
  fn(currentState);
  return () => listeners.delete(fn);
}

function setState(s: SyncState) {
  currentState = s;
  listeners.forEach((l) => l(s));
}

function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// Convert a local row to the cloud payload shape (snake_case + user_id).
function toCloud(table: keyof typeof TABLE_MAP, row: unknown, userId: string): Record<string, unknown> {
  if (table === "courses") {
    const c = row as Course;
    return {
      id: c.id,
      user_id: userId,
      name: c.name,
      total_hours: c.totalHours,
      semester_id: c.semesterId,
      archived: c.archived,
      // İsteğe bağlı: 0 = Hazırlık, 1..6 = sınıf, null = belirtilmemiş.
      grade: c.grade ?? null,
      deleted: c.deleted,
      updated_at: new Date(c.updatedAt).toISOString(),
      client_id: c.clientId,
    };
  }
  if (table === "records") {
    const r = row as AbsenceRecord;
    return {
      id: r.id,
      user_id: userId,
      course_id: r.courseId,
      date: r.date,
      hours: r.hours,
      // İsteğe bağlı kısa açıklama; yoksa null.
      note: r.note ?? null,
      deleted: r.deleted,
      updated_at: new Date(r.updatedAt).toISOString(),
      client_id: r.clientId,
    };
  }
  const s = row as Semester;
  return {
    id: s.id,
    user_id: userId,
    name: s.name,
    active: s.active,
    deleted: s.deleted,
    updated_at: new Date(s.updatedAt).toISOString(),
    client_id: s.clientId,
  };
}

// `grade` (courses) ve `note` (absence_records) sonradan eklendi ve Supabase
// tarafında migration gerektiriyor. Migration çalıştırılmamışsa Postgres
// bilinmeyen sütun yüzünden TÜM kaydı reddeder: ders buluta hiç ulaşmaz,
// kuyrukta sonsuza dek bekler ve profil sıfırlanınca (kuyruk da temizlendiği
// için) kalıcı olarak kaybolur. Hata da yalnızca konsola düştüğü için
// kullanıcı hiçbir şey fark etmez.
//
// Bu yüzden senkronizasyon migration'dan BAĞIMSIZ çalışmalı: sütun yoksa
// tespit edip bu alanları düşürerek devam ediyoruz. Migration sonradan
// çalıştırılırsa (sayfa yenilenince) alanlar yeniden gönderilmeye başlar.
let optionalColsMissing = false;

function stripOptionalCols(row: Record<string, unknown>): Record<string, unknown> {
  const { grade: _g, note: _n, ...rest } = row;
  return rest;
}

function isUnknownColumnError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const msg = String(err?.message ?? "");
  // PGRST204: PostgREST şema önbelleğinde sütun yok. 42703: Postgres
  // undefined_column.
  return (
    code === "PGRST204" ||
    code === "42703" ||
    /could not find the '(grade|note)' column/i.test(msg) ||
    /column "?(grade|note)"? (of relation .* )?does not exist/i.test(msg)
  );
}

let flushing = false;

// Push queued local writes to Supabase. Safe no-op when offline / not signed in.
export async function flushSyncQueue(): Promise<void> {
  if (!isCloudEnabled()) return;
  const client = supabase();
  if (!client) return;

  const settings = await getSettings();
  if (settings.isGuest || !settings.userId) return; // guest data never syncs
  if (!online()) {
    const n = await db().syncQueue.count();
    setState(n > 0 ? "pending" : "synced");
    return;
  }
  if (flushing) return;
  flushing = true;
  setState("syncing");

  try {
    const ops = await db().syncQueue.orderBy("createdAt").toArray();
    for (const op of ops) {
      const cloudRow = toCloud(op.table, op.payload, settings.userId);
      const tableName = TABLE_MAP[op.table];
      // Upsert works for both create/update and soft-delete (deleted flag).
      let { error } = await client
        .from(tableName)
        .upsert(optionalColsMissing ? stripOptionalCols(cloudRow) : cloudRow, { onConflict: "id" });
      // Sütunlar yoksa (migration çalıştırılmamış) kaydı KAYBETME: isteğe
      // bağlı alanları düşürüp tekrar dene. Aksi halde ders sonsuza dek
      // kuyrukta kalır ve profil sıfırlanınca yok olur.
      if (error && !optionalColsMissing && isUnknownColumnError(error)) {
        optionalColsMissing = true;
        console.warn(
          "[sync] Supabase'de grade/note sütunu yok (migration çalıştırılmamış). " +
            "Bu alanlar olmadan senkronize ediliyor; sınıf ve açıklama buluta yazılmayacak. " +
            "supabase/migrations/001_add_course_grade_and_record_note.sql dosyasını çalıştırın.",
        );
        ({ error } = await client
          .from(tableName)
          .upsert(stripOptionalCols(cloudRow), { onConflict: "id" }));
      }
      if (error) throw error;
      if (op.id != null) await db().syncQueue.delete(op.id);
    }
    setState("synced");
  } catch (e) {
    // Leave items in the queue; will retry on next trigger / reconnect.
    console.warn("[sync] flush failed, will retry:", e);
    setState("pending");
  } finally {
    flushing = false;
  }
}

// Pull remote rows and merge with last-write-wins on updated_at.
export async function pullRemote(): Promise<void> {
  if (!isCloudEnabled()) return;
  const client = supabase();
  if (!client) return;
  const settings = await getSettings();
  if (settings.isGuest || !settings.userId || !online()) return;

  try {
    const [{ data: sems }, { data: crs }, { data: recs }] = await Promise.all([
      client.from("semesters").select("*").eq("user_id", settings.userId),
      client.from("courses").select("*").eq("user_id", settings.userId),
      client.from("absence_records").select("*").eq("user_id", settings.userId),
    ]);

    for (const s of sems ?? []) {
      await mergeLocal("semesters", {
        id: s.id,
        name: s.name,
        active: s.active,
        deleted: s.deleted,
        updatedAt: Date.parse(s.updated_at),
        clientId: s.client_id,
        createdAt: Date.parse(s.updated_at),
      } as Semester);
    }
    for (const c of crs ?? []) {
      await mergeLocal("courses", {
        id: c.id,
        name: c.name,
        totalHours: c.total_hours,
        semesterId: c.semester_id,
        archived: c.archived,
        grade: c.grade ?? null,
        deleted: c.deleted,
        updatedAt: Date.parse(c.updated_at),
        clientId: c.client_id,
        createdAt: Date.parse(c.updated_at),
      } as Course);
    }
    for (const r of recs ?? []) {
      await mergeLocal("records", {
        id: r.id,
        courseId: r.course_id,
        date: r.date,
        hours: r.hours,
        note: r.note ?? null,
        deleted: r.deleted,
        updatedAt: Date.parse(r.updated_at),
        clientId: r.client_id,
        createdAt: Date.parse(r.updated_at),
      } as AbsenceRecord);
    }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("gmt-data-changed"));
  } catch (e) {
    console.warn("[sync] pull failed:", e);
  }
}

// Last-write-wins merge.
async function mergeLocal(
  table: "courses" | "records" | "semesters",
  remote: Course | AbsenceRecord | Semester
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any =
    table === "courses" ? db().courses : table === "records" ? db().records : db().semesters;
  const local = await t.get(remote.id);
  if (!local || remote.updatedAt >= local.updatedAt) {
    // Preserve local-only fields (createdAt, notif flags) when present.
    const merged = local ? { ...local, ...remote } : remote;
    await t.put(merged);
  }
}

export function currentSyncState(): SyncState {
  return currentState;
}

// Register background-sync + connectivity listeners. Call once on app mount.
export function initSync() {
  if (typeof window === "undefined") return;

  const trigger = () => {
    void flushSyncQueue();
  };
  window.addEventListener("gmt-enqueue", trigger);
  window.addEventListener("online", () => {
    void (async () => {
      await flushSyncQueue();
      await pullRemote();
    })();
  });
  window.addEventListener("offline", () => setState("offline"));

  // Service worker Background Sync message → flush.
  navigator.serviceWorker?.addEventListener("message", (ev) => {
    if ((ev.data as { type?: string })?.type === "gmt-flush-sync") trigger();
  });

  // Register a background sync tag when supported (best-effort).
  navigator.serviceWorker?.ready
    .then((reg) => (reg as unknown as { sync?: { register: (t: string) => Promise<void> } }).sync?.register("gmt-sync"))
    .catch(() => {});

  // Initial reconcile.
  void (async () => {
    await flushSyncQueue();
    await pullRemote();
  })();
}
