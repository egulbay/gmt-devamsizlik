// Shared domain types

export type Lang = "tr" | "en";
export type Theme = "light" | "dark";
export type SyncState = "synced" | "pending" | "syncing" | "offline";

export interface Course {
  id: string;
  name: string;
  totalHours: number; // devamsızlık hakkı — DERS SAATİ cinsinden
  semesterId: string; // hangi döneme ait
  archived: boolean; // arşivlenmiş dönem dersi mi
  createdAt: number;
  updatedAt: number;
  clientId: string;
  deleted: boolean; // tombstone (senkronizasyon için)
  // bildirim durumu
  notifiedTwoLeft?: boolean;
  notifiedLimit?: boolean;
  lastWeeklyNotifyAt?: number | null;
}

export interface AbsenceRecord {
  id: string;
  courseId: string;
  date: string; // "YYYY-MM-DD"
  hours: number; // o gün gelinmeyen ders saati
  createdAt: number;
  updatedAt: number;
  clientId: string;
  deleted: boolean;
}

export interface Semester {
  id: string;
  name: string; // ör. "2025-2026 Bahar"
  active: boolean;
  createdAt: number;
  updatedAt: number;
  clientId: string;
  deleted: boolean;
}

export interface Settings {
  key: string; // "app"
  lang: Lang;
  theme: Theme;
  userName: string | null;
  isGuest: boolean;
  userId: string | null; // supabase user id (hesaplı kullanıcı)
  activeSemesterId: string | null;
  notificationsEnabled: boolean;
  updatedAt: number;
}

// Sync queue entry (offline yazma kuyruğu)
export interface SyncOp {
  id?: number; // autoincrement
  table: "courses" | "records" | "semesters";
  rowId: string;
  op: "upsert" | "delete";
  payload: unknown;
  createdAt: number;
}

// View-model course with computed absence stats
export interface CourseVM extends Course {
  usedHours: number;
  remainingHours: number;
  ratio: number;
  warn: boolean;
  warnClass: "mid" | "high";
}
