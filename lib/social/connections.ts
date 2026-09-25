import { supabase } from "../sync/supabaseClient";
import { classify, type SocialResult } from "./profile";

// Bağlantı istekleri, bağlantı listesi ve engelleme. Hepsi sunucu
// fonksiyonlarından geçiyor (migration 009): istemci ne başkasının profilini
// tarayabiliyor ne de engeli atlayabiliyor.

export interface Person {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  classYear?: number | null;
}

export interface PendingRequest extends Person {
  id: string;
  direction: "incoming" | "outgoing";
  createdAt: string;
}

export type SendResult = "sent" | "connected" | "already" | "blocked" | "self";

function client() {
  const c = supabase();
  if (!c) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  return c;
}

export async function sendRequest(userId: string): Promise<SocialResult<SendResult>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("send_connection_request", { p_user_id: userId });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as SendResult };
}

export async function respondRequest(id: string, accept: boolean): Promise<SocialResult<string>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("respond_connection_request", { p_id: id, p_accept: accept });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function cancelRequest(id: string): Promise<SocialResult<string>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("cancel_connection_request", { p_id: id });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function listRequests(): Promise<SocialResult<PendingRequest[]>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("list_connection_requests");
  if (error) return { ok: false, error: classify(error) };
  const rows = (data ?? []) as {
    id: string;
    direction: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    created_at: string;
  }[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      direction: r.direction === "incoming" ? "incoming" : "outgoing",
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      createdAt: r.created_at,
    })),
  };
}

export async function listConnections(): Promise<SocialResult<Person[]>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("list_connections");
  if (error) return { ok: false, error: classify(error) };
  const rows = (data ?? []) as {
    user_id: string;
    display_name: string;
    department: string | null;
    class_year: number | null;
    avatar_url: string | null;
  }[];
  return {
    ok: true,
    data: rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      department: r.department,
      classYear: r.class_year,
      avatarUrl: r.avatar_url,
    })),
  };
}

export async function removeConnection(userId: string): Promise<SocialResult<string>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("remove_connection", { p_user_id: userId });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function blockUser(userId: string): Promise<SocialResult<string>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("block_user", { p_user_id: userId });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function unblockUser(userId: string): Promise<SocialResult<string>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("unblock_user", { p_user_id: userId });
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as string };
}

export async function listBlocks(): Promise<SocialResult<Person[]>> {
  const c = client();
  if (!c) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc("list_blocks");
  if (error) return { ok: false, error: classify(error) };
  const rows = (data ?? []) as { user_id: string; display_name: string; avatar_url: string | null }[];
  return { ok: true, data: rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url })) };
}
