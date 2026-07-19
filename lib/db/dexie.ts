import Dexie, { type Table } from "dexie";
import type { Course, AbsenceRecord, Semester, Settings, SyncOp, Project } from "../types";

// Offline-first local store. All user data lives here (IndexedDB) — never in
// localStorage, per the architecture rules.
export class GmtDexie extends Dexie {
  courses!: Table<Course, string>;
  records!: Table<AbsenceRecord, string>;
  semesters!: Table<Semester, string>;
  settings!: Table<Settings, string>;
  syncQueue!: Table<SyncOp, number>;
  projects!: Table<Project, string>;

  constructor() {
    super("gmt-devamsizlik");
    this.version(1).stores({
      courses: "id, semesterId, updatedAt, deleted",
      records: "id, courseId, date, updatedAt, deleted",
      semesters: "id, active, updatedAt, deleted",
      settings: "key",
      syncQueue: "++id, table, rowId, createdAt",
    });
    // v2: projeler/yapılacaklar özelliği (deneysel — henüz buluta senkronize
    // edilmiyor, bkz. repo.ts'teki not). Var olan tabloları tekrar
    // belirtmeye gerek yok, Dexie önceki sürümlerden devralır.
    this.version(2).stores({
      projects: "id, semesterId, courseId, dueDate, updatedAt, deleted",
    });
  }
}

let _db: GmtDexie | null = null;

// Lazily instantiate so it never runs during SSR.
export function db(): GmtDexie {
  if (typeof window === "undefined") {
    throw new Error("Dexie is browser-only");
  }
  if (!_db) _db = new GmtDexie();
  return _db;
}

// Per-device client id (used for last-write-wins conflict resolution).
// Stored inside IndexedDB settings, not localStorage.
let _clientId: string | null = null;

export async function getClientId(): Promise<string> {
  if (_clientId) return _clientId;
  const meta = await db().settings.get("_client");
  if (meta && (meta as unknown as { clientId?: string }).clientId) {
    _clientId = (meta as unknown as { clientId: string }).clientId;
    return _clientId;
  }
  const id = "dev_" + crypto.randomUUID();
  await db().settings.put({ key: "_client", clientId: id } as unknown as Settings);
  _clientId = id;
  return id;
}

export function newId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID();
}
