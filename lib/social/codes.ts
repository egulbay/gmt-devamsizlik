import { supabase } from "../sync/supabaseClient";
import { classify, type SocialResult } from "./profile";

// Kişiye özel bağlantı kodu (bkz. migration 008). Kod ÜRETİMİ ve SORGULAMASI
// sunucu fonksiyonlarından geçer: istemci ne tabloyu tarayabilir ne de kendine
// kod seçebilir. Sorgulama ayrıca hız sınırlıdır (10 dakikada 10 deneme).

export interface CodeMatch {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  // Aramızdaki durum: bağlı mıyız, istek bekliyor mu? Arayüz buna göre
  // "İstek Gönder" mi yoksa "istek gönderildi" mi göstereceğine karar verir.
  relation?: "none" | "connected" | "outgoing" | "incoming";
}

// Hız sınırına takılmak ayrı bir durum: kullanıcıya "biraz bekle" demeliyiz.
export type LookupOutcome =
  | { kind: "found"; match: CodeMatch }
  | { kind: "notFound" }
  | { kind: "self" }
  | { kind: "rateLimited" };

function rpcError(e: { message?: string } | null): "rateLimited" | null {
  return /rate_limited/.test(e?.message ?? "") ? "rateLimited" : null;
}

export async function ensureMyCode(): Promise<SocialResult<string>> {
  const client = supabase();
  if (!client) return { ok: false, error: "notReady" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, error: "offline" };
  const { data, error } = await client.rpc("ensure_my_code");
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function rotateMyCode(): Promise<SocialResult<string>> {
  const client = supabase();
  if (!client) return { ok: false, error: "notReady" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, error: "offline" };
  const { data, error } = await client.rpc("rotate_my_code");
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function lookupCode(code: string, myCode: string | null): Promise<SocialResult<LookupOutcome>> {
  const client = supabase();
  if (!client) return { ok: false, error: "notReady" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, error: "offline" };
  // Kendi kodunu aratınca sunucu da "bulunamadı" der; farkı burada anlatıyoruz
  // ki kullanıcı "kod yanlış mı?" diye uğraşmasın.
  if (myCode && normalizeCode(code) === normalizeCode(myCode)) {
    return { ok: true, data: { kind: "self" } };
  }
  const { data, error } = await client.rpc("lookup_code", { p_code: code });
  if (error) {
    if (rpcError(error)) return { ok: true, data: { kind: "rateLimited" } };
    return { ok: false, error: classify(error) };
  }
  const rows = (data ?? []) as {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    relation?: string;
  }[];
  if (!rows.length) return { ok: true, data: { kind: "notFound" } };
  const r = rows[0];
  return {
    ok: true,
    data: {
      kind: "found",
      match: {
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        relation: (r.relation as CodeMatch["relation"]) ?? "none",
      },
    },
  };
}

// --- biçim yardımcıları -----------------------------------------------------

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// Kullanıcının elle yazdığı kodu tek biçime indirger: küçük harf, boşluk ve
// tire serbest, baştaki "GMT" isteğe bağlı.
//
// Karışan karakterler (0/O, 1/I/L) BİLEREK düzeltilmiyor: kodda bunların
// hiçbiri geçmediği için yanlış yazılmışlardır, ama hangi harf kastedildiği
// belli değil. Tahmin etmek, kullanıcıyı sessizce BAŞKA birinin koduna
// götürebilirdi. Onun yerine kod geçersiz sayılır ve kullanıcı uyarılır.
export function normalizeCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("GMT") ? cleaned.slice(3) : cleaned;
  return body.slice(0, 8);
}

// Ekranda gösterilecek biçim: GMT-XXXX-XXXX
export function formatCode(body: string): string {
  const b = normalizeCode(body);
  return b.length === 8 ? `GMT-${b.slice(0, 4)}-${b.slice(4)}` : b;
}

export function isValidCode(raw: string): boolean {
  const b = normalizeCode(raw);
  return b.length === 8 && [...b].every((ch) => ALPHABET.includes(ch));
}

// Davet linki: uygulama açılınca ?c= parametresini okuyup bağlantı ekranına
// gider. Adres çalışma anında belirlenir ki test adresinde de doğru olsun.
export function inviteLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://gmt-devamsizlik.vercel.app";
  return `${origin}/?c=${encodeURIComponent(formatCode(code))}`;
}
