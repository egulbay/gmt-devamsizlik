import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Günlük hatırlatma işi.
//
// Uygulama içindeki kontrol yalnızca kullanıcı uygulamayı AÇTIĞINDA çalışır.
// Bu uç nokta, uygulama kapalıyken de telefona bildirim düşmesini sağlar:
// Vercel Cron günde bir kez çağırır, kayıtlı telefonlara push gönderir.
//
// Hangi uyarının gönderildiği BULUTTA işaretlenir (courses.notified_*,
// projects.notified_due_milestones) — böylece aynı uyarı hem sunucudan hem
// uygulamadan iki kez gitmez ve ertesi gün tekrarlanmaz.
//
// Gereken ortam değişkenleri (Vercel > Settings > Environment Variables):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUE_MILESTONES = [14, 7, 3, 1];

type Msg = { title: string; body: string; tag: string };

const T = {
  tr: {
    title: "GMT Takip",
    twoLeft: (n: string) => `"${n}" dersinden 2 saat hakkın kaldı.`,
    limit: (n: string) => `"${n}" dersinde devamsızlık sınırına ulaştın!`,
    dueToday: (n: string) => `"${n}" projesinin teslimi bugün!`,
    dueIn: (n: string, d: number) =>
      d === 1
        ? `"${n}" projesinin teslimine 1 gün kaldı!`
        : d === 7
          ? `"${n}" projesinin teslimine 1 hafta kaldı.`
          : d === 14
            ? `"${n}" projesinin teslimine 2 hafta kaldı.`
            : `"${n}" projesinin teslimine ${d} gün kaldı.`,
  },
  en: {
    title: "GMT Takip",
    twoLeft: (n: string) => `You have 2 hours left for "${n}".`,
    limit: (n: string) => `You've reached the absence limit for "${n}"!`,
    dueToday: (n: string) => `"${n}" is due today!`,
    dueIn: (n: string, d: number) =>
      d === 1
        ? `"${n}" is due in 1 day!`
        : d === 7
          ? `"${n}" is due in 1 week.`
          : d === 14
            ? `"${n}" is due in 2 weeks.`
            : `"${n}" is due in ${d} days.`,
  },
};

// Teslim tarihine kalan tam gün (UTC gün farkı; saat dilimi kayması için
// sabahın erken saatinde çalıştığından bir günlük sapma önemsiz).
function daysUntil(due: string): number {
  const today = new Date();
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const d = new Date(due + "T00:00:00Z").getTime();
  return Math.round((d - t) / 86400000);
}

export async function GET(req: Request) {
  // Vercel Cron, CRON_SECRET tanımlıysa Authorization başlığıyla çağırır.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!url || !serviceKey || !pub || !priv) {
    return Response.json({ error: "eksik ortam değişkeni", sent: 0 }, { status: 500 });
  }
  webpush.setVapidDetails("mailto:egulbay04@gmail.com", pub, priv);

  // Service role: RLS'i aşar, tüm kullanıcıların satırlarını okuyabilir.
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: subs, error: subErr } = await db.from("push_subscriptions").select("*");
  if (subErr) return Response.json({ error: subErr.message }, { status: 500 });
  if (!subs?.length) return Response.json({ users: 0, sent: 0 });

  // Kullanıcı başına abonelikler
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  let sent = 0;
  let removed = 0;

  for (const [userId, userSubs] of byUser) {
    const lang = (userSubs[0]?.lang === "en" ? "en" : "tr") as "tr" | "en";
    const t = T[lang];
    const msgs: Msg[] = [];

    // --- Dersler: 2 saat kaldı / sınıra ulaşıldı ---
    const [{ data: courses }, { data: records }, { data: projects }] = await Promise.all([
      db.from("courses").select("*").eq("user_id", userId).eq("deleted", false).eq("archived", false),
      db.from("absence_records").select("course_id,hours,deleted").eq("user_id", userId).eq("deleted", false),
      db.from("projects").select("*").eq("user_id", userId).eq("deleted", false).eq("completed", false),
    ]);

    const usedByCourse = new Map<string, number>();
    for (const r of records ?? []) {
      usedByCourse.set(r.course_id, (usedByCourse.get(r.course_id) ?? 0) + Number(r.hours ?? 0));
    }

    for (const c of courses ?? []) {
      const remaining = Number(c.total_hours ?? 0) - (usedByCourse.get(c.id) ?? 0);
      if (remaining <= 0 && !c.notified_limit) {
        msgs.push({ title: t.title, body: t.limit(c.name), tag: `gmt-${c.id}` });
        await db
          .from("courses")
          .update({ notified_limit: true, notified_two_left: true, updated_at: new Date().toISOString() })
          .eq("id", c.id);
      } else if (remaining > 0 && remaining <= 2 && !c.notified_two_left) {
        msgs.push({ title: t.title, body: t.twoLeft(c.name), tag: `gmt-${c.id}` });
        await db
          .from("courses")
          .update({ notified_two_left: true, updated_at: new Date().toISOString() })
          .eq("id", c.id);
      }
    }

    // --- Projeler: teslime 14 / 7 / 3 / 1 gün kala ---
    for (const p of projects ?? []) {
      if (!p.due_date) continue;
      const left = daysUntil(p.due_date);
      if (left < 0) continue;
      const done: number[] = Array.isArray(p.notified_due_milestones) ? p.notified_due_milestones : [];
      // Girilen EN DAR eşik (uygulama içindeki mantığın aynısı).
      const candidates = DUE_MILESTONES.filter((m) => left <= m);
      const hit = candidates[candidates.length - 1];
      if (hit === undefined || done.includes(hit)) continue;
      msgs.push({
        title: t.title,
        body: left <= 0 ? t.dueToday(p.name) : t.dueIn(p.name, left),
        tag: `gmt-due-${p.id}`,
      });
      await db
        .from("projects")
        .update({
          notified_due_milestones: Array.from(new Set([...done, ...DUE_MILESTONES.filter((m) => m >= hit)])),
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id);
    }

    if (!msgs.length) continue;

    for (const sub of userSubs) {
      for (const m of msgs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(m),
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // 404/410: abonelik ölmüş (uygulama kaldırılmış, izin geri alınmış).
          if (status === 404 || status === 410) {
            await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            removed++;
            break;
          }
        }
      }
    }
  }

  return Response.json({ users: byUser.size, sent, removed });
}
