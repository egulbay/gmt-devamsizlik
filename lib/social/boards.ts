import { db, newId, getClientId } from "../db/dexie";
import { getSettings } from "../db/repo";
import { supabase } from "../sync/supabaseClient";
import { classify, type SocialError, type SocialResult } from "./profile";
import type { Board, BoardRole, Card, CardStatus, Workspace } from "../types";

// Panoların yerel deposu ve senkronu.
//
// Neden ayrı bir motor: dersler/devamsızlık tek kullanıcıya ait ve satır
// bazında "son yazan kazanır" yetiyor. Panolarda ise aynı kartı iki kişi
// düzenleyebiliyor; bu yüzden güncellemelerde SATIRIN TAMAMI değil yalnızca
// DEĞİŞEN ALANLAR gönderiliyor. Böylece biri başlığı, diğeri teslim tarihini
// değiştirdiğinde ikisi de korunuyor (alan bazında son yazan kazanır).
//
// Çevrimdışıyken: panolar ve kartlar yerelden okunur, değişiklikler kuyruğa
// yazılır. Bağlantı gelince kuyruk boşalır. Bağlantı isteği/kod sorgulama ve
// üye yönetimi çevrimiçi gerektirir — arayüz bunu ayrıca söyler.

export interface BoardPerson {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: BoardRole | null;
}

export interface ActivityEntry {
  id: number;
  actorName: string | null;
  kind: string;
  cardTitle: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AssignedCard {
  cardId: string;
  boardId: string;
  boardName: string;
  title: string;
  status: CardStatus;
  dueDate: string | null;
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

// ---------------------------------------------------------------- yerel ----

export async function localWorkspaces(): Promise<Workspace[]> {
  const rows = await db().workspaces.toArray();
  return rows.filter((w) => !w.deleted).sort((a, b) => a.name.localeCompare(b.name));
}

export async function localBoards(workspaceId?: string): Promise<Board[]> {
  const rows = await db().boards.toArray();
  return rows
    .filter((b) => !b.deleted && (!workspaceId || b.workspaceId === workspaceId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function localCards(boardId: string): Promise<Card[]> {
  const rows = await db().cards.where("boardId").equals(boardId).toArray();
  return rows.filter((c) => !c.deleted).sort((a, b) => a.position - b.position);
}

async function queue(op: {
  table: "workspaces" | "boards" | "cards";
  rowId: string;
  op: "insert" | "patch" | "delete";
  fields?: string[];
  payload: unknown;
}): Promise<void> {
  await db().boardQueue.add({ ...op, createdAt: Date.now() });
}

// --------------------------------------------------------- yerel yazma ----

export async function createCard(
  boardId: string,
  title: string,
  extra?: { notes?: string | null; dueDate?: string | null; assignees?: string[] },
): Promise<Card> {
  const settings = await getSettings();
  const clientId = await getClientId();
  const existing = await localCards(boardId);
  const card: Card = {
    id: newId("card"),
    boardId,
    title: title.trim().slice(0, 200),
    notes: extra?.notes?.trim() || null,
    status: "todo",
    dueDate: extra?.dueDate || null,
    // Yeni kart en sona: mevcut en büyük sıradan bir fazlası.
    position: existing.length ? Math.max(...existing.map((c) => c.position)) + 1 : 0,
    assignees: extra?.assignees ?? [],
    completedBy: null,
    completedAt: null,
    createdBy: settings.userId ?? "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clientId,
    deleted: false,
  };
  await db().cards.put(card);
  await queue({ table: "cards", rowId: card.id, op: "insert", payload: card });
  return card;
}

export async function patchCard(id: string, patch: Partial<Card>): Promise<Card | null> {
  const cur = await db().cards.get(id);
  if (!cur) return null;
  const settings = await getSettings();
  const next: Card = { ...cur, ...patch, updatedAt: Date.now(), clientId: await getClientId() };
  // "Tamamlandı"ya geçişte kimin bitirdiğini ve ne zaman bittiğini yazıyoruz;
  // geri alınınca temizliyoruz ki eski bilgi yanıltmasın.
  if (patch.status && patch.status !== cur.status) {
    if (patch.status === "done") {
      next.completedBy = settings.userId ?? null;
      next.completedAt = Date.now();
    } else {
      next.completedBy = null;
      next.completedAt = null;
    }
  }
  await db().cards.put(next);
  const fields = Object.keys(patch).concat(
    patch.status && patch.status !== cur.status ? ["completedBy", "completedAt"] : [],
  );
  await queue({ table: "cards", rowId: id, op: "patch", fields, payload: next });
  return next;
}

export async function deleteCard(id: string): Promise<void> {
  const cur = await db().cards.get(id);
  if (!cur) return;
  const next = { ...cur, deleted: true, updatedAt: Date.now() };
  await db().cards.put(next);
  await queue({ table: "cards", rowId: id, op: "patch", fields: ["deleted"], payload: next });
}

// --------------------------------------------------- sunucu işlemleri -----

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<SocialResult<T>> {
  const c = supabase();
  if (!c) return { ok: false, error: "notReady" };
  if (!online()) return { ok: false, error: "offline" };
  const { data, error } = await c.rpc(name, args);
  if (error) return { ok: false, error: classify(error) };
  return { ok: true, data: data as T };
}

export async function createWorkspace(name: string): Promise<SocialResult<string>> {
  const res = await rpc<string>("create_workspace", { p_name: name.trim().slice(0, 60) });
  if (res.ok) await pullBoards();
  return res;
}

export async function createBoard(
  workspaceId: string,
  name: string,
  view: "list" | "kanban",
): Promise<SocialResult<string>> {
  const res = await rpc<string>("create_board", {
    p_workspace: workspaceId,
    p_name: name.trim().slice(0, 60),
    p_view: view,
  });
  if (res.ok) await pullBoards();
  return res;
}

export async function renameBoard(id: string, name: string): Promise<SocialResult<null>> {
  const c = supabase();
  if (!c) return { ok: false, error: "notReady" };
  if (!online()) return { ok: false, error: "offline" };
  const { error } = await c.from("boards").update({ name: name.trim().slice(0, 60) }).eq("id", id);
  if (error) return { ok: false, error: classify(error) };
  await pullBoards();
  return { ok: true, data: null };
}

export async function setBoardView(id: string, view: "list" | "kanban"): Promise<void> {
  const cur = await db().boards.get(id);
  if (cur) await db().boards.put({ ...cur, viewMode: view });
  const c = supabase();
  if (c && online()) await c.from("boards").update({ view_mode: view }).eq("id", id);
}

export async function deleteBoard(id: string): Promise<SocialResult<null>> {
  const c = supabase();
  if (!c) return { ok: false, error: "notReady" };
  if (!online()) return { ok: false, error: "offline" };
  // Kalıcı silmek yerine işaretliyoruz: yanlışlıkla silinen bir pano
  // veritabanından kurtarılabilsin.
  const { error } = await c.from("boards").update({ deleted: true }).eq("id", id);
  if (error) return { ok: false, error: classify(error) };
  await db().boards.delete(id);
  return { ok: true, data: null };
}

export async function deleteWorkspace(id: string): Promise<SocialResult<null>> {
  const c = supabase();
  if (!c) return { ok: false, error: "notReady" };
  if (!online()) return { ok: false, error: "offline" };
  const { error } = await c.from("workspaces").update({ deleted: true }).eq("id", id);
  if (error) return { ok: false, error: classify(error) };
  await db().workspaces.delete(id);
  return { ok: true, data: null };
}

export async function listPeople(boardId: string): Promise<SocialResult<BoardPerson[]>> {
  const res = await rpc<{ user_id: string; display_name: string; avatar_url: string | null; role: string | null }[]>(
    "list_board_people",
    { p_board: boardId },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      role: (r.role as BoardRole | null) ?? null,
    })),
  };
}

export async function addMember(
  opts: { workspaceId?: string; boardId?: string; userId: string; role?: "admin" | "member" },
): Promise<SocialResult<string>> {
  return rpc<string>("add_member", {
    p_workspace: opts.workspaceId ?? null,
    p_board: opts.boardId ?? null,
    p_user: opts.userId,
    p_role: opts.role ?? "member",
  });
}

export async function removeMember(opts: { workspaceId?: string; boardId?: string; userId: string }) {
  return rpc<string>("remove_member", {
    p_workspace: opts.workspaceId ?? null,
    p_board: opts.boardId ?? null,
    p_user: opts.userId,
  });
}

export async function setMemberRole(opts: {
  workspaceId?: string;
  boardId?: string;
  userId: string;
  role: BoardRole;
}) {
  return rpc<string>("set_member_role", {
    p_workspace: opts.workspaceId ?? null,
    p_board: opts.boardId ?? null,
    p_user: opts.userId,
    p_role: opts.role,
  });
}

export async function createInvite(opts: {
  workspaceId?: string;
  boardId?: string;
  role?: "admin" | "member";
  hours?: number;
}): Promise<SocialResult<string>> {
  return rpc<string>("create_invite", {
    p_workspace: opts.workspaceId ?? null,
    p_board: opts.boardId ?? null,
    p_role: opts.role ?? "member",
    p_hours: opts.hours ?? 48,
  });
}

export async function revokeInvite(code: string) {
  return rpc<string>("revoke_invite", { p_code: code });
}

export async function joinWithInvite(code: string): Promise<SocialResult<{ kind: string; name: string | null }>> {
  const res = await rpc<{ kind: string; target_name: string | null }[]>("join_with_invite", { p_code: code });
  if (!res.ok) return res;
  const row = res.data?.[0];
  if (!row || row.kind === "invalid") return { ok: true, data: { kind: "invalid", name: null } };
  await pullBoards();
  return { ok: true, data: { kind: row.kind, name: row.target_name } };
}

export async function boardActivity(boardId: string): Promise<SocialResult<ActivityEntry[]>> {
  const res = await rpc<
    { id: number; actor_name: string | null; kind: string; card_title: string | null; detail: string | null; created_at: string }[]
  >("list_board_activity", { p_board: boardId, p_limit: 30 });
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      kind: r.kind,
      cardTitle: r.card_title,
      detail: r.detail,
      createdAt: r.created_at,
    })),
  };
}

export async function assignedToMe(): Promise<SocialResult<AssignedCard[]>> {
  const res = await rpc<
    { card_id: string; board_id: string; board_name: string; title: string; status: string; due_date: string | null }[]
  >("my_assigned_cards", {});
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((r) => ({
      cardId: r.card_id,
      boardId: r.board_id,
      boardName: r.board_name,
      title: r.title,
      status: r.status as CardStatus,
      dueDate: r.due_date,
    })),
  };
}

// Panonun hangi derse ait olduğu SADECE bu cihazın sahibine görünür:
// ders adları ve devamsızlık verisi kimseyle paylaşılmaz.
export async function setBoardCourse(boardId: string, courseId: string | null): Promise<void> {
  const c = supabase();
  const settings = await getSettings();
  if (!c || !online() || !settings.userId) return;
  if (courseId) {
    await c
      .from("board_course_links")
      .upsert({ user_id: settings.userId, board_id: boardId, course_id: courseId }, { onConflict: "user_id,board_id" });
  } else {
    await c.from("board_course_links").delete().eq("user_id", settings.userId).eq("board_id", boardId);
  }
}

export async function boardCourseLinks(): Promise<Record<string, string>> {
  const c = supabase();
  const settings = await getSettings();
  if (!c || !online() || !settings.userId) return {};
  const { data } = await c.from("board_course_links").select("board_id,course_id").eq("user_id", settings.userId);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { board_id: string; course_id: string }[]) out[r.board_id] = r.course_id;
  return out;
}

// -------------------------------------------------------------- senkron ----

const CARD_COLS: Record<string, string> = {
  title: "title",
  notes: "notes",
  status: "status",
  dueDate: "due_date",
  position: "position",
  deleted: "deleted",
  completedBy: "completed_by",
  completedAt: "completed_at",
};

function cardToCloud(c: Card): Record<string, unknown> {
  return {
    id: c.id,
    board_id: c.boardId,
    title: c.title,
    notes: c.notes ?? null,
    status: c.status,
    due_date: c.dueDate ?? null,
    position: c.position,
    completed_by: c.completedBy ?? null,
    completed_at: c.completedAt ? new Date(c.completedAt).toISOString() : null,
    created_by: c.createdBy,
    deleted: c.deleted,
    client_id: c.clientId,
    updated_at: new Date(c.updatedAt).toISOString(),
  };
}

let flushing = false;

export async function flushBoardQueue(): Promise<void> {
  const c = supabase();
  if (!c || !online() || flushing) return;
  const settings = await getSettings();
  if (settings.isGuest || !settings.userId) return;
  flushing = true;
  try {
    const ops = await db().boardQueue.orderBy("createdAt").toArray();
    for (const op of ops) {
      if (op.table !== "cards") {
        if (op.id != null) await db().boardQueue.delete(op.id);
        continue;
      }
      const card = op.payload as Card;
      if (op.op === "insert") {
        const { error } = await c.from("cards").upsert(cardToCloud(card), { onConflict: "id" });
        if (error) throw error;
        await syncAssignees(card);
      } else {
        // Yalnızca değişen alanlar: aynı kartı düzenleyen ikinci kişinin
        // dokunmadığı alanlar korunur.
        const patch: Record<string, unknown> = {
          updated_at: new Date(card.updatedAt).toISOString(),
          client_id: card.clientId,
        };
        for (const f of op.fields ?? []) {
          const col = CARD_COLS[f];
          if (!col) continue;
          patch[col] = cardToCloud(card)[col];
        }
        const { error } = await c.from("cards").update(patch).eq("id", card.id);
        if (error) throw error;
        if ((op.fields ?? []).includes("assignees")) await syncAssignees(card);
      }
      if (op.id != null) await db().boardQueue.delete(op.id);
    }
  } catch (e) {
    // Kuyrukta bırak: bağlanınca / yeniden denerken gönderilir.
    console.warn("[panolar] gönderilemedi, tekrar denenecek:", e);
  } finally {
    flushing = false;
  }
}

async function syncAssignees(card: Card): Promise<void> {
  const c = supabase();
  if (!c) return;
  await c.from("card_assignees").delete().eq("card_id", card.id);
  if (card.assignees.length) {
    await c.from("card_assignees").insert(card.assignees.map((u) => ({ card_id: card.id, user_id: u })));
  }
}

export async function pullBoards(): Promise<SocialError | null> {
  const c = supabase();
  if (!c || !online()) return "offline";
  const settings = await getSettings();
  if (settings.isGuest || !settings.userId) return null;

  // RLS zaten yalnızca üyesi olduğumuz satırları döndürüyor; ayrıca filtreye
  // gerek yok. Tablolar yoksa (migration çalıştırılmamış) "hazır değil" deyip
  // uygulamayı çökertmiyoruz.
  const ws = await c.from("workspaces").select("id,name,deleted,updated_at");
  if (ws.error) return classify(ws.error);
  const members = await c.from("workspace_members").select("workspace_id,user_id,role");
  const bs = await c.from("boards").select("id,workspace_id,name,view_mode,deleted,updated_at");
  if (bs.error) return classify(bs.error);
  const cs = await c
    .from("cards")
    .select("id,board_id,title,notes,status,due_date,position,completed_by,completed_at,created_by,deleted,updated_at,client_id");
  if (cs.error) return classify(cs.error);
  const as = await c.from("card_assignees").select("card_id,user_id");

  const myRoles = new Map<string, BoardRole>();
  for (const m of (members.data ?? []) as { workspace_id: string; user_id: string; role: string }[]) {
    if (m.user_id === settings.userId) myRoles.set(m.workspace_id, m.role as BoardRole);
  }

  const keepWs = new Set<string>();
  for (const w of (ws.data ?? []) as { id: string; name: string; deleted: boolean; updated_at: string }[]) {
    if (w.deleted) {
      await db().workspaces.delete(w.id);
      continue;
    }
    keepWs.add(w.id);
    await db().workspaces.put({
      id: w.id,
      name: w.name,
      myRole: myRoles.get(w.id) ?? "member",
      updatedAt: Date.parse(w.updated_at),
      deleted: false,
    });
  }
  // Sunucuda görünmeyen (çıkarıldığımız ya da silinen) alanları yerelden at.
  for (const w of await db().workspaces.toArray()) if (!keepWs.has(w.id)) await db().workspaces.delete(w.id);

  const keepBoards = new Set<string>();
  for (const b of (bs.data ?? []) as {
    id: string;
    workspace_id: string;
    name: string;
    view_mode: string;
    deleted: boolean;
    updated_at: string;
  }[]) {
    if (b.deleted) {
      await db().boards.delete(b.id);
      continue;
    }
    keepBoards.add(b.id);
    await db().boards.put({
      id: b.id,
      workspaceId: b.workspace_id,
      name: b.name,
      viewMode: b.view_mode === "kanban" ? "kanban" : "list",
      updatedAt: Date.parse(b.updated_at),
      deleted: false,
    });
  }
  for (const b of await db().boards.toArray()) if (!keepBoards.has(b.id)) await db().boards.delete(b.id);

  const assignees = new Map<string, string[]>();
  for (const a of (as.data ?? []) as { card_id: string; user_id: string }[]) {
    assignees.set(a.card_id, [...(assignees.get(a.card_id) ?? []), a.user_id]);
  }

  // Gönderilmeyi bekleyen kartlara DOKUNMA: yereldeki değişiklik henüz
  // buluta gitmediyse sunucudaki eski hali onu ezmemeli.
  const pending = new Set((await db().boardQueue.toArray()).map((o) => o.rowId));
  const keepCards = new Set<string>();
  for (const r of (cs.data ?? []) as Record<string, unknown>[]) {
    const id = r.id as string;
    if (pending.has(id)) {
      keepCards.add(id);
      continue;
    }
    if (r.deleted) {
      await db().cards.delete(id);
      continue;
    }
    keepCards.add(id);
    await db().cards.put({
      id,
      boardId: r.board_id as string,
      title: r.title as string,
      notes: (r.notes as string) ?? null,
      status: r.status as CardStatus,
      dueDate: (r.due_date as string) ?? null,
      position: Number(r.position ?? 0),
      assignees: assignees.get(id) ?? [],
      completedBy: (r.completed_by as string) ?? null,
      completedAt: r.completed_at ? Date.parse(r.completed_at as string) : null,
      createdBy: r.created_by as string,
      createdAt: Date.parse(r.updated_at as string),
      updatedAt: Date.parse(r.updated_at as string),
      clientId: (r.client_id as string) ?? "",
      deleted: false,
    });
  }
  for (const card of await db().cards.toArray()) {
    if (!keepCards.has(card.id) && !pending.has(card.id)) await db().cards.delete(card.id);
  }
  return null;
}

// Panoları açarken: önce bekleyenleri gönder, sonra sunucudan tazele.
export async function syncBoards(): Promise<SocialError | null> {
  await flushBoardQueue();
  return pullBoards();
}
