import { supabase, isCloudEnabled } from "../sync/supabaseClient";

// Başka kullanıcılara gösterilebilecek minimal profil (bkz. migration 007).
// E-posta bilerek yok: hiçbir zaman başka kullanıcıya gösterilmez.
export interface Profile {
  userId: string;
  displayName: string;
  department: string | null;
  classYear: number | null;
  avatarUrl: string | null;
}

// Sosyal özellikler her zaman çevrimiçi sunucuyla konuşur; sonuç ya veri ya
// da ekranda gösterilecek nedenlerden biri.
export type SocialError = "offline" | "notReady" | "failed";
export type SocialResult<T> = { ok: true; data: T } | { ok: false; error: SocialError };

// Tablo yoksa (migration çalıştırılmamış) PostgREST "PGRST205" ya da Postgres
// "42P01" döner. Bu durumda uygulama çökmemeli, "sunucu hazır değil" demeli.
export function classify(e: { code?: string; message?: string } | null): SocialError {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  const code = e?.code ?? "";
  if (code === "PGRST205" || code === "42P01" || code === "PGRST202" || code === "42883") return "notReady";
  if (/fetch|network/i.test(e?.message ?? "")) return "offline";
  return "failed";
}

type Row = {
  user_id: string;
  display_name: string;
  department: string | null;
  class_year: number | null;
  avatar_url: string | null;
};

export function fromRow(r: Row): Profile {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    department: r.department,
    classYear: r.class_year,
    avatarUrl: r.avatar_url,
  };
}

// Sunucu yalnızca Google'ın fotoğraf adresini kabul ediyor; başka bir adres
// gelirse profili hiç kaydedememek yerine fotoğrafsız kaydediyoruz.
function safeAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(url) && url.length <= 500 ? url : null;
}

const COLS = "user_id,display_name,department,class_year,avatar_url";

// Merkez açıldığında çağrılır: profil yoksa Google adıyla oluşturur. Varsa
// kullanıcının seçtiği adı EZMEZ; yalnızca değişmiş olabilecek Google
// fotoğrafını tazeler.
export async function ensureMyProfile(
  userId: string,
  googleName: string | null,
  googleAvatar: string | null
): Promise<SocialResult<Profile>> {
  if (!isCloudEnabled()) return { ok: false, error: "notReady" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, error: "offline" };
  const client = supabase();
  if (!client) return { ok: false, error: "notReady" };

  const avatar = safeAvatar(googleAvatar);
  const { data, error } = await client.from("profiles").select(COLS).eq("user_id", userId).maybeSingle();
  if (error) return { ok: false, error: classify(error) };

  if (!data) {
    const name = (googleName ?? "").trim().slice(0, 60) || "GMT";
    const ins = await client
      .from("profiles")
      .insert({ user_id: userId, display_name: name, avatar_url: avatar })
      .select(COLS)
      .single();
    if (ins.error) return { ok: false, error: classify(ins.error) };
    return { ok: true, data: fromRow(ins.data as Row) };
  }

  const row = data as Row;
  if (avatar && row.avatar_url !== avatar) {
    const up = await client.from("profiles").update({ avatar_url: avatar }).eq("user_id", userId).select(COLS).single();
    if (!up.error) return { ok: true, data: fromRow(up.data as Row) };
  }
  return { ok: true, data: fromRow(row) };
}

export async function updateMyProfile(
  userId: string,
  patch: { displayName: string; department: string | null; classYear: number | null }
): Promise<SocialResult<Profile>> {
  const client = supabase();
  if (!client) return { ok: false, error: "notReady" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, error: "offline" };
  const { data, error } = await client
    .from("profiles")
    .update({
      display_name: patch.displayName.trim().slice(0, 60),
      department: patch.department?.trim().slice(0, 80) || null,
      class_year: patch.classYear,
    })
    .eq("user_id", userId)
    .select(COLS)
    .single();
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: fromRow(data as Row) };
}
