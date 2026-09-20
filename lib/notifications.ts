import { tf } from "./i18n";
import { updateCourse, updateProject, DUE_MILESTONES, daysUntilDue } from "./db/repo";
import type { Course, AbsenceRecord, Lang, Project } from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function permission(): NotificationPermission {
  if (!notificationsSupported()) return "denied";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// Show a notification via the service worker (works when installed as PWA).
export async function showLocalNotification(title: string, body: string, tag?: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: "/icons/gmt-logo-mark.png",
      badge: "/icons/gmt-logo-mark.png",
      tag: tag || "gmt-alert",
    });
  } catch {
    // Fallback to a plain Notification.
    try {
      new Notification(title, { body, icon: "/icons/gmt-logo-mark.png" });
    } catch {
      /* ignore */
    }
  }
}

// A single toast-worthy alert result (for in-app toast even without permission).
export interface AlertResult {
  courseId: string;
  body: string;
  kind: "twoLeft" | "weekly" | "limit" | "projectDue";
}

// Teslim tarihi yaklaşan projeler için 14/7/3/1 gün eşiklerinde tek seferlik
// bildirim. Bir eşik geçildiğinde "harcandı" olarak işaretlenir; aynı eşik
// için bir daha bildirim gitmez. Proje eklenirken zaten geçilmiş olan
// eşikler addProject/updateProject tarafında baştan harcanmış sayılır — yani
// 8 gün kala eklenen bir projede 14 eşiği hiç tetiklenmez, 7/3/1 tetiklenir.
export async function evaluateProjectNotifications(
  projects: Project[],
  lang: Lang,
): Promise<AlertResult[]> {
  const t = tf(lang);
  const alerts: AlertResult[] = [];

  for (const p of projects) {
    if (p.deleted || p.completed || !p.dueDate) continue;
    const left = daysUntilDue(p.dueDate);
    if (left < 0) continue; // teslim tarihi geçmiş — artık hatırlatma yok

    const done = p.notifiedDueMilestones ?? [];
    // Girilen EN DAR eşik (14/7/3/1 arasında left'i kapsayan en küçüğü).
    // En büyüğünü seçmek yanlış olurdu: uygulama bir süre hiç açılmadıysa
    // 2 gün kala hâlâ 7 eşiği harcanmamış olur ve "1 hafta kaldı" derdi.
    const candidates = DUE_MILESTONES.filter((m) => left <= m);
    const hit = candidates[candidates.length - 1];
    if (hit === undefined || done.includes(hit)) continue;

    // Metin gerçek kalan günle kurulur (eşik etiketiyle değil) — zamanında
    // tetiklendiğinde zaten left === hit olur ve "1 hafta / 2 hafta" der.
    const body = t.notifDueIn(p.name, left);
    alerts.push({ courseId: p.id, body, kind: "projectDue" });
    await showLocalNotification(t.notifDemoTitle, body, "gmt-due-" + p.id);
    // Bu eşik ve ondan büyük tüm eşikleri harcanmış say — arada uygulama hiç
    // açılmadıysa (ör. 14'ten 2 güne atlandıysa) geçmiş eşikler için art arda
    // bildirim yağmuru olmasın.
    await updateProject(p.id, {
      notifiedDueMilestones: Array.from(new Set([...done, ...DUE_MILESTONES.filter((m) => m >= hit)])),
    });
  }
  return alerts;
}

// Evaluate threshold logic across courses. Returns any alerts fired, and
// persists the notification-state flags so we don't spam the user.
//   - remaining <= 2h (and not yet notified)  → "twoLeft"
//   - already notified & not over limit        → weekly reminder
//   - remaining <= 0                           → final "limit" notice, then stop
export async function evaluateNotifications(
  courses: Course[],
  recordsByCourse: Record<string, AbsenceRecord[]>,
  lang: Lang
): Promise<AlertResult[]> {
  const t = tf(lang);
  const alerts: AlertResult[] = [];
  const now = Date.now();

  for (const c of courses) {
    if (c.archived || c.deleted) continue;
    const used = (recordsByCourse[c.id] ?? []).reduce((a, r) => a + r.hours, 0);
    const remaining = c.totalHours - used;

    if (remaining <= 0) {
      if (!c.notifiedLimit) {
        const body = t.notifLimit(c.name);
        alerts.push({ courseId: c.id, body, kind: "limit" });
        await showLocalNotification(t.notifDemoTitle, body, "gmt-" + c.id);
        await updateCourse(c.id, { notifiedLimit: true, notifiedTwoLeft: true });
      }
      continue; // limit reached → stop notifying
    }

    if (remaining <= 2) {
      if (!c.notifiedTwoLeft) {
        const body = t.notifTwoLeft(c.name);
        alerts.push({ courseId: c.id, body, kind: "twoLeft" });
        await showLocalNotification(t.notifDemoTitle, body, "gmt-" + c.id);
        await updateCourse(c.id, { notifiedTwoLeft: true, lastWeeklyNotifyAt: now });
      } else {
        // Weekly reminder if still under the limit.
        const last = c.lastWeeklyNotifyAt ?? 0;
        if (now - last >= WEEK_MS) {
          const body = t.notifWeekly(c.name);
          alerts.push({ courseId: c.id, body, kind: "weekly" });
          await showLocalNotification(t.notifDemoTitle, body, "gmt-weekly-" + c.id);
          await updateCourse(c.id, { lastWeeklyNotifyAt: now });
        }
      }
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Web Push aboneliği
//
// Uygulama içindeki kontrol yalnızca uygulama açıkken çalışır. Telefona
// uygulama kapalıyken de bildirim düşmesi için tarayıcının verdiği "abonelik"
// adresi sunucuya kaydedilir; günlük çalışan iş (app/api/cron/notify) oraya
// gönderir. Abonelik cihaza özeldir: her telefon kendi kaydını oluşturur.
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || !notificationsSupported() || Notification.permission !== "granted") return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!("pushManager" in reg)) return null;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  } catch (e) {
    console.warn("[push] abonelik kurulamadı:", e);
    return null;
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[sw] registration failed:", e);
  }
}
