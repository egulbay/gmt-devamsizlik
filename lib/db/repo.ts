import { db, getClientId, newId } from "./dexie";
import type {
  Course,
  AbsenceRecord,
  Semester,
  Settings,
  Lang,
  Theme,
} from "../types";

const SETTINGS_KEY = "app";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<Settings> {
  const existing = await db().settings.get(SETTINGS_KEY);
  if (existing) return existing;
  const fresh: Settings = {
    key: SETTINGS_KEY,
    lang: "tr",
    // Always boot in light theme, regardless of the device's system color
    // scheme. The user can switch to dark manually; that choice is what
    // persists (in IndexedDB, not localStorage).
    theme: "light",
    userName: null,
    isGuest: false,
    userId: null,
    activeSemesterId: null,
    notificationsEnabled: false,
    updatedAt: Date.now(),
  };
  await db().settings.put(fresh);
  return fresh;
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch, key: SETTINGS_KEY, updatedAt: Date.now() };
  await db().settings.put(next);
  return next;
}

export async function setTheme(theme: Theme) {
  return patchSettings({ theme });
}
export async function setLang(lang: Lang) {
  return patchSettings({ lang });
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------
async function enqueue(
  table: "courses" | "records" | "semesters",
  rowId: string,
  op: "upsert" | "delete",
  payload: unknown
) {
  await db().syncQueue.add({ table, rowId, op, payload, createdAt: Date.now() });
  // Ask the app (and service worker) to try flushing.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gmt-enqueue"));
  }
}

// ---------------------------------------------------------------------------
// Semesters
// ---------------------------------------------------------------------------
// Repair pass for data damaged by the old sign-in race: each reinstall used
// to fabricate a fresh "active" semester, so one account could accumulate
// several active semesters with its courses scattered across them (and the
// UI, pointing at the newest empty one, looked wiped). Merge them: keep the
// oldest as canonical, move every course over, tombstone the ghosts. All
// changes are enqueued so the cloud copy heals too.
let semestersRepaired = false;

async function repairDuplicateActiveSemesters(): Promise<void> {
  // Run at most once per session, and flip the flag BEFORE any await so
  // concurrent reloads can't start overlapping repairs. Without this the
  // repair's own enqueues re-trigger reload → ensureActiveSemester → repair
  // in a feedback loop that livelocks the tab.
  if (semestersRepaired) return;
  semestersRepaired = true;
  const all = await db().semesters.toArray();
  const actives = all
    .filter((s) => s.active && !s.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (actives.length <= 1) return;
  const canonical = actives[0];
  const clientId = await getClientId();
  const now = Date.now();
  for (const ghost of actives.slice(1)) {
    const courses = await db().courses.where("semesterId").equals(ghost.id).toArray();
    for (const c of courses) {
      const moved = { ...c, semesterId: canonical.id, updatedAt: now, clientId };
      await db().courses.put(moved);
      await enqueue("courses", c.id, "upsert", moved);
    }
    const tomb = { ...ghost, active: false, deleted: true, updatedAt: now, clientId };
    await db().semesters.put(tomb);
    await enqueue("semesters", ghost.id, "delete", tomb);
  }
  await patchSettings({ activeSemesterId: canonical.id });
}

// Rescue pass: any non-archived course whose semester is missing, deleted, or
// no longer active is invisible in every list (Aktif shows only the active
// semester's courses; Geçmiş shows only archived semesters). Such strays are
// left behind by the old sign-in race + interrupted repairs. Move them into
// the current active semester so they become visible again; enqueue so the
// cloud heals too. Runs once per session (same livelock caution as above).
let straysRescued = false;

async function rescueStrayCourses(active: Semester): Promise<void> {
  if (straysRescued) return;
  straysRescued = true;
  const sems = await db().semesters.toArray();
  const semById = new Map(sems.map((s) => [s.id, s]));
  const courses = await db().courses.toArray();
  const clientId = await getClientId();
  const now = Date.now();
  for (const c of courses) {
    if (c.deleted || c.archived) continue;
    if (c.semesterId === active.id) continue;
    const home = semById.get(c.semesterId);
    if (home && !home.deleted && home.active) continue;
    const moved = { ...c, semesterId: active.id, updatedAt: now, clientId };
    await db().courses.put(moved);
    await enqueue("courses", c.id, "upsert", moved);
  }
}

export async function ensureActiveSemester(): Promise<Semester> {
  await repairDuplicateActiveSemesters();
  const s = await getSettings();
  let sem: Semester | null = null;
  if (s.activeSemesterId) {
    const found = await db().semesters.get(s.activeSemesterId);
    // The pointer must reference a semester that is BOTH alive and still
    // active. Checking only `deleted` let a stale pointer at an archived
    // (active:false) semester win forever: new courses were created inside
    // the archived semester and the real active one — with all its courses —
    // was never shown.
    if (found && !found.deleted && found.active) sem = found;
  }
  if (!sem) {
    // activeSemesterId is device-local and never comes from the cloud. If
    // it's missing/stale but an active semester already exists locally (e.g.
    // just pulled down from Supabase after a reinstall), adopt it instead of
    // fabricating a phantom semester that would orphan the real courses.
    const existingActive = (await db().semesters.toArray()).find((x) => x.active && !x.deleted);
    if (existingActive) {
      await patchSettings({ activeSemesterId: existingActive.id });
      sem = existingActive;
    }
  }
  if (!sem) {
    // Create a default active semester.
    const now = Date.now();
    const clientId = await getClientId();
    const created: Semester = {
      id: newId("sem"),
      name: defaultSemesterName(),
      active: true,
      createdAt: now,
      updatedAt: now,
      clientId,
      deleted: false,
    };
    await db().semesters.put(created);
    await patchSettings({ activeSemesterId: created.id });
    await enqueue("semesters", created.id, "upsert", created);
    sem = created;
  }
  await rescueStrayCourses(sem);
  return sem;
}

function defaultSemesterName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-11
  // TR akademik takvim kabaca: Eyl-Oca Güz, Şub-Haz Bahar
  const isFall = m >= 8 || m <= 0;
  return isFall ? `${y}-${y + 1} Güz` : `${y - 1}-${y} Bahar`;
}

export async function listSemesters(): Promise<Semester[]> {
  const all = await db().semesters.toArray();
  return all.filter((s) => !s.deleted).sort((a, b) => b.createdAt - a.createdAt);
}

export async function listArchivedSemesters(): Promise<Semester[]> {
  return (await listSemesters()).filter((s) => !s.active);
}

// Arşivle: aktif dönemin derslerini archived yap, yeni aktif dönem oluştur.
export async function startNewSemester(name: string): Promise<Semester> {
  const clientId = await getClientId();
  const now = Date.now();
  const settings = await getSettings();

  // Mark current active semester + its courses as archived.
  if (settings.activeSemesterId) {
    const cur = await db().semesters.get(settings.activeSemesterId);
    if (cur) {
      const updated = { ...cur, active: false, updatedAt: now, clientId };
      await db().semesters.put(updated);
      await enqueue("semesters", cur.id, "upsert", updated);
    }
    const courses = await db()
      .courses.where("semesterId")
      .equals(settings.activeSemesterId)
      .toArray();
    for (const c of courses) {
      const updated = { ...c, archived: true, updatedAt: now, clientId };
      await db().courses.put(updated);
      await enqueue("courses", c.id, "upsert", updated);
    }
  }

  const sem: Semester = {
    id: newId("sem"),
    name: name.trim() || defaultSemesterName(),
    active: true,
    createdAt: now,
    updatedAt: now,
    clientId,
    deleted: false,
  };
  await db().semesters.put(sem);
  await patchSettings({ activeSemesterId: sem.id });
  await enqueue("semesters", sem.id, "upsert", sem);
  return sem;
}

// Delete a whole (archived) semester: tombstone the semester itself plus every
// course under it and each course's absence records, so nothing is left
// orphaned locally or in the cloud. Refuses to delete the currently-active
// semester — that's what "Profili Sıfırla / Değiştir" is for.
export async function deleteSemester(semesterId: string): Promise<void> {
  const sem = await db().semesters.get(semesterId);
  if (!sem || sem.deleted) return;
  const settings = await getSettings();
  if (sem.active || settings.activeSemesterId === semesterId) return;

  const clientId = await getClientId();
  const now = Date.now();

  const courses = await db().courses.where("semesterId").equals(semesterId).toArray();
  for (const c of courses) {
    if (!c.deleted) {
      const cTomb = { ...c, deleted: true, updatedAt: now, clientId };
      await db().courses.put(cTomb);
      await enqueue("courses", c.id, "delete", cTomb);
    }
    const recs = await db().records.where("courseId").equals(c.id).toArray();
    for (const r of recs) {
      if (r.deleted) continue;
      const rTomb = { ...r, deleted: true, updatedAt: now, clientId };
      await db().records.put(rTomb);
      await enqueue("records", r.id, "delete", rTomb);
    }
  }

  const semTomb = { ...sem, deleted: true, updatedAt: now, clientId };
  await db().semesters.put(semTomb);
  await enqueue("semesters", semesterId, "delete", semTomb);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
export async function listActiveCourses(): Promise<Course[]> {
  const sem = await ensureActiveSemester();
  const all = await db().courses.where("semesterId").equals(sem.id).toArray();
  return all
    .filter((c) => !c.deleted && !c.archived)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listCoursesBySemester(semesterId: string): Promise<Course[]> {
  const all = await db().courses.where("semesterId").equals(semesterId).toArray();
  return all.filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCourse(id: string): Promise<Course | undefined> {
  const c = await db().courses.get(id);
  return c && !c.deleted ? c : undefined;
}

export async function addCourse(name: string, totalHours: number): Promise<Course> {
  const clientId = await getClientId();
  const sem = await ensureActiveSemester();
  const now = Date.now();
  const course: Course = {
    id: newId("crs"),
    name: name.trim(),
    totalHours,
    semesterId: sem.id,
    archived: false,
    createdAt: now,
    updatedAt: now,
    clientId,
    deleted: false,
    notifiedTwoLeft: false,
    notifiedLimit: false,
    lastWeeklyNotifyAt: null,
  };
  await db().courses.put(course);
  await enqueue("courses", course.id, "upsert", course);
  return course;
}

export async function updateCourse(
  id: string,
  patch: Partial<Pick<Course, "name" | "totalHours" | "notifiedTwoLeft" | "notifiedLimit" | "lastWeeklyNotifyAt">>
): Promise<Course | undefined> {
  const cur = await db().courses.get(id);
  if (!cur) return undefined;
  const clientId = await getClientId();
  const next = { ...cur, ...patch, updatedAt: Date.now(), clientId };
  await db().courses.put(next);
  await enqueue("courses", id, "upsert", next);
  return next;
}

export async function deleteCourse(id: string): Promise<void> {
  const cur = await db().courses.get(id);
  if (!cur) return;
  const clientId = await getClientId();
  // Tombstone the course + its records.
  const now = Date.now();
  const tomb = { ...cur, deleted: true, updatedAt: now, clientId };
  await db().courses.put(tomb);
  await enqueue("courses", id, "delete", tomb);

  const recs = await db().records.where("courseId").equals(id).toArray();
  for (const r of recs) {
    const rt = { ...r, deleted: true, updatedAt: now, clientId };
    await db().records.put(rt);
    await enqueue("records", r.id, "delete", rt);
  }
}

// ---------------------------------------------------------------------------
// Absence records
// ---------------------------------------------------------------------------
export async function listRecords(courseId: string): Promise<AbsenceRecord[]> {
  const all = await db().records.where("courseId").equals(courseId).toArray();
  return all.filter((r) => !r.deleted).sort((a, b) => b.date.localeCompare(a.date));
}

export async function usedHours(courseId: string): Promise<number> {
  const recs = await listRecords(courseId);
  return recs.reduce((a, r) => a + r.hours, 0);
}

// Upsert a record for a specific (course, date). One record per day per course.
export async function setRecord(
  courseId: string,
  date: string,
  hours: number,
  recordId?: string
): Promise<AbsenceRecord> {
  const clientId = await getClientId();
  const now = Date.now();
  // Find existing record for that date (or by id).
  let existing: AbsenceRecord | undefined;
  if (recordId) existing = await db().records.get(recordId);
  if (!existing) {
    const sameDay = (await db().records.where("courseId").equals(courseId).toArray()).filter(
      (r) => !r.deleted && r.date === date
    );
    existing = sameDay[0];
  }
  const rec: AbsenceRecord = existing
    ? { ...existing, hours, date, updatedAt: now, clientId, deleted: false }
    : {
        id: newId("rec"),
        courseId,
        date,
        hours,
        createdAt: now,
        updatedAt: now,
        clientId,
        deleted: false,
      };
  await db().records.put(rec);
  await enqueue("records", rec.id, "upsert", rec);
  return rec;
}

export async function deleteRecord(recordId: string): Promise<void> {
  const cur = await db().records.get(recordId);
  if (!cur) return;
  const clientId = await getClientId();
  const tomb = { ...cur, deleted: true, updatedAt: Date.now(), clientId };
  await db().records.put(tomb);
  await enqueue("records", recordId, "delete", tomb);
}

export async function clearRecordsForCourse(courseId: string): Promise<void> {
  const recs = await db().records.where("courseId").equals(courseId).toArray();
  const clientId = await getClientId();
  const now = Date.now();
  for (const r of recs) {
    if (r.deleted) continue;
    const tomb = { ...r, deleted: true, updatedAt: now, clientId };
    await db().records.put(tomb);
    await enqueue("records", r.id, "delete", tomb);
  }
  // Bildirim durumunu da sıfırla ki tekrar uyarabilsin.
  await updateCourse(courseId, {
    notifiedTwoLeft: false,
    notifiedLimit: false,
    lastWeeklyNotifyAt: null,
  });
}

// ---------------------------------------------------------------------------
// Profile reset — wipe everything on this device.
// ---------------------------------------------------------------------------
export async function resetProfile(): Promise<void> {
  await db().transaction(
    "rw",
    db().courses,
    db().records,
    db().semesters,
    db().settings,
    db().syncQueue,
    async () => {
      await db().courses.clear();
      await db().records.clear();
      await db().semesters.clear();
      await db().syncQueue.clear();
      // keep _client id; drop app settings
      await db().settings.delete(SETTINGS_KEY);
    }
  );
}

// ---------------------------------------------------------------------------
// Guest → account migration
// Reassign all local data to the signed-in user (data already lives locally;
// we just flip the flags and let the sync engine push it to the cloud).
// ---------------------------------------------------------------------------
export async function migrateGuestToAccount(userId: string, userName: string | null) {
  await patchSettings({ isGuest: false, userId, userName });
  // Re-enqueue everything so it gets pushed to the account's cloud store.
  const clientId = await getClientId();
  const courses = await db().courses.toArray();
  const records = await db().records.toArray();
  const semesters = await db().semesters.toArray();
  for (const s of semesters) await enqueue("semesters", s.id, s.deleted ? "delete" : "upsert", { ...s, clientId });
  for (const c of courses) await enqueue("courses", c.id, c.deleted ? "delete" : "upsert", { ...c, clientId });
  for (const r of records) await enqueue("records", r.id, r.deleted ? "delete" : "upsert", { ...r, clientId });
}

export async function pendingSyncCount(): Promise<number> {
  return db().syncQueue.count();
}
