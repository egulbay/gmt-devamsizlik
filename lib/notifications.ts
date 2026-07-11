import { tf } from "./i18n";
import { updateCourse } from "./db/repo";
import type { Course, AbsenceRecord, Lang } from "./types";

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
  kind: "twoLeft" | "weekly" | "limit";
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

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[sw] registration failed:", e);
  }
}
