"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { Board, Card, CardStatus, Workspace } from "@/lib/types";
import {
  localWorkspaces,
  localBoards,
  localCards,
  createWorkspace,
  createBoard,
  deleteBoard,
  deleteWorkspace,
  setBoardView,
  createCard,
  patchCard,
  deleteCard,
  syncBoards,
  joinWithInvite,
  listPeople,
  addMember,
  removeMember,
  setMemberRole,
  createInvite,
  revokeInvite,
  boardActivity,
  pendingBoardOps,
  type BoardPerson,
  type ActivityEntry,
} from "@/lib/social/boards";
import { listConnections, type Person } from "@/lib/social/connections";
import Avatar from "./Avatar";
import QrCode from "./QrCode";

// Çalışma alanları → panolar → kartlar.
//
// Kartlar ve panolar çevrimdışıyken de okunup yazılabilir (Dexie). Üye
// yönetimi, davet kodu ve aktivite akışı sunucuyla konuşur; çevrimdışıyken
// bu butonlar kapanır ve nedeni yazılır.

const STATUSES: CardStatus[] = ["todo", "doing", "done"];

export default function Boards({
  t,
  online,
  showToast,
  userId,
}: {
  t: Dict;
  online: boolean;
  showToast: (title: string, body: string) => void;
  userId: string;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [openBoard, setOpenBoard] = useState<Board | null>(null);
  const [newWs, setNewWs] = useState("");
  const [newBoardFor, setNewBoardFor] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardView, setNewBoardView] = useState<"list" | "kanban">("list");
  const [inviteInput, setInviteInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ kind: "board" | "workspace"; id: string } | null>(null);

  const reload = useCallback(async () => {
    setWorkspaces(await localWorkspaces());
    setBoards(await localBoards());
  }, []);

  useEffect(() => {
    void (async () => {
      await reload();
      if (online) {
        await syncBoards();
        await reload();
      }
    })();
  }, [reload, online]);

  const statusLabel = (s: CardStatus) =>
    s === "todo" ? t.hubStatusTodo : s === "doing" ? t.hubStatusDoing : t.hubStatusDone;

  // Çalışma alanı görünmeyen panolar (yalnızca o panoya davet edilmişsin).
  const orphanBoards = boards.filter((b) => !workspaces.some((w) => w.id === b.workspaceId));

  if (openBoard) {
    return (
      <BoardView
        t={t}
        board={openBoard}
        online={online}
        userId={userId}
        showToast={showToast}
        statusLabel={statusLabel}
        onBack={async () => {
          setOpenBoard(null);
          await reload();
        }}
      />
    );
  }

  const addWorkspace = async () => {
    if (!newWs.trim()) return;
    setBusy(true);
    const res = await createWorkspace(newWs);
    setBusy(false);
    if (!res.ok) {
      showToast(t.hubBoardsTitle, res.error === "offline" ? t.hubOnlineNeeded : t.hubFailed);
      return;
    }
    setNewWs("");
    await reload();
  };

  const addBoard = async (wsId: string) => {
    if (!newBoardName.trim()) return;
    setBusy(true);
    const res = await createBoard(wsId, newBoardName, newBoardView);
    setBusy(false);
    if (!res.ok) {
      showToast(t.hubBoardsTitle, res.error === "offline" ? t.hubOnlineNeeded : t.hubFailed);
      return;
    }
    setNewBoardName("");
    setNewBoardFor(null);
    await reload();
  };

  const join = async () => {
    if (!inviteInput.trim()) return;
    setBusy(true);
    const res = await joinWithInvite(inviteInput);
    setBusy(false);
    if (!res.ok) {
      showToast(t.hubJoinInvite, res.error === "offline" ? t.hubOnlineNeeded : t.hubFailed);
      return;
    }
    if (res.data.kind === "invalid") {
      showToast(t.hubJoinInvite, t.hubInviteInvalid);
      return;
    }
    showToast(t.hubJoinInvite, t.hubJoined(res.data.name ?? ""));
    setInviteInput("");
    await reload();
  };

  const confirmDelete = async () => {
    if (!ask) return;
    const cur = ask;
    setAsk(null);
    const res = cur.kind === "board" ? await deleteBoard(cur.id) : await deleteWorkspace(cur.id);
    if (!res.ok) showToast(t.hubBoardsTitle, res.error === "offline" ? t.hubOnlineNeeded : t.hubOnlyManager);
    await reload();
  };

  return (
    <>
      {!online && <div className="hub-note fs13">{t.hubOfflineBoards}</div>}

      {workspaces.length === 0 && orphanBoards.length === 0 && (
        <div className="fs13 sub">{t.hubNoWorkspaces}</div>
      )}

      {/* Yalnızca TEK BİR PANOYA davet edildiysen o panonun çalışma alanını
          görmüyor olabilirsin. Pano yine de kaybolmasın diye ayrı bir başlık
          altında listeleniyor. */}
      {orphanBoards.length > 0 && (
        <div className="set-group">
          <div className="set-title">{t.hubSharedBoards}</div>
          {orphanBoards.map((b) => (
            <button key={b.id} className="set-row set-link" onClick={() => setOpenBoard(b)}>
              <span className="set-ic">📋</span>
              <div className="set-row-text fw7 fs14">{b.name}</div>
              <span className="set-chev">›</span>
            </button>
          ))}
        </div>
      )}

      {workspaces.map((w) => {
        const wsBoards = boards.filter((b) => b.workspaceId === w.id);
        const canManage = w.myRole === "owner" || w.myRole === "admin";
        return (
          <div key={w.id} className="set-group">
            <div className="row between">
              <div className="set-title">{w.name}</div>
              <span className="hub-soon">
                {w.myRole === "owner" ? t.hubRoleOwner : w.myRole === "admin" ? t.hubRoleAdmin : t.hubRoleMember}
              </span>
            </div>

            {wsBoards.length === 0 && <div className="fs13 sub">{t.hubNoBoards}</div>}
            {wsBoards.map((b) => (
              <button key={b.id} className="set-row set-link" onClick={() => setOpenBoard(b)}>
                <span className="set-ic">📋</span>
                <div className="set-row-text fw7 fs14">{b.name}</div>
                <span className="set-chev">›</span>
              </button>
            ))}

            {canManage && newBoardFor === w.id ? (
              <div className="stack" style={{ gap: 8 }}>
                <input
                  className="input"
                  placeholder={t.hubBoardName}
                  value={newBoardName}
                  maxLength={60}
                  onChange={(e) => setNewBoardName(e.target.value)}
                />
                <div className="field-label">{t.hubBoardView}</div>
                <div className="seg">
                  <button className={newBoardView === "list" ? "active" : ""} onClick={() => setNewBoardView("list")}>
                    {t.hubViewList}
                  </button>
                  <button className={newBoardView === "kanban" ? "active" : ""} onClick={() => setNewBoardView("kanban")}>
                    {t.hubViewKanban}
                  </button>
                </div>
                <div className="sheet-actions">
                  <button className="btn-secondary" onClick={() => setNewBoardFor(null)}>{t.hubCancel}</button>
                  <button className="btn-primary" disabled={busy || !online} onClick={() => void addBoard(w.id)}>
                    {t.hubCreate}
                  </button>
                </div>
              </div>
            ) : (
              canManage && (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn-secondary hub-act" disabled={!online} onClick={() => setNewBoardFor(w.id)}>
                    {t.hubNewBoard}
                  </button>
                  {w.myRole === "owner" && (
                    <button
                      className="btn-secondary hub-act"
                      disabled={!online}
                      onClick={() => setAsk({ kind: "workspace", id: w.id })}
                    >
                      {t.hubDeleteWorkspace}
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}

      {/* ---- Yeni çalışma alanı ---- */}
      <div className="set-group">
        <div className="set-title">{t.hubNewWorkspace}</div>
        <div className="fs12 sub">{t.hubWorkspaceHint}</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={t.hubWorkspaceName}
            value={newWs}
            maxLength={60}
            onChange={(e) => setNewWs(e.target.value)}
          />
          <button className="set-btn" disabled={busy || !online || !newWs.trim()} onClick={() => void addWorkspace()}>
            {t.hubCreate}
          </button>
        </div>
      </div>

      {/* ---- Davet koduyla katıl ---- */}
      <div className="set-group">
        <div className="set-title">{t.hubJoinInvite}</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={t.hubInvitePlaceholder}
            value={inviteInput}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setInviteInput(e.target.value)}
          />
          <button className="set-btn" disabled={busy || !online || !inviteInput.trim()} onClick={() => void join()}>
            {t.hubJoin}
          </button>
        </div>
      </div>

      {ask && (
        <>
          <div className="scrim" onClick={() => setAsk(null)} />
          <div className="sheet" role="dialog">
            <div className="sheet-handle" />
            <div className="fw8 fs17">{ask.kind === "board" ? t.hubDeleteBoardTitle : t.hubDeleteWorkspaceTitle}</div>
            <div className="fs13 sub">{ask.kind === "board" ? t.hubDeleteBoardDesc : t.hubDeleteWorkspaceDesc}</div>
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={() => setAsk(null)}>{t.hubCancel}</button>
              <button className="btn-primary" onClick={() => void confirmDelete()}>
                {ask.kind === "board" ? t.hubDeleteBoard : t.hubDeleteWorkspace}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ======================= tek pano =========================================

function BoardView({
  t,
  board,
  online,
  userId,
  showToast,
  statusLabel,
  onBack,
}: {
  t: Dict;
  board: Board;
  online: boolean;
  userId: string;
  showToast: (title: string, body: string) => void;
  statusLabel: (s: CardStatus) => string;
  onBack: () => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [view, setView] = useState<"list" | "kanban">(board.viewMode);
  const [people, setPeople] = useState<BoardPerson[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [askDeleteBoard, setAskDeleteBoard] = useState(false);
  // Buluta gönderilemeyen değişiklik sayısı. Sıfırdan büyükse kullanıcı
  // bunu GÖRMELİ: sessiz kalırsa kartlar kaybolmuş gibi görünüyor.
  const [pending, setPending] = useState(0);

  const myRole = people.find((p) => p.userId === userId)?.role ?? null;
  const canManage = myRole === "owner" || myRole === "admin";

  const reload = useCallback(async () => {
    setCards(await localCards(board.id));
    setPending(await pendingBoardOps());
  }, [board.id]);

  useEffect(() => {
    void (async () => {
      await reload();
      if (!online) return;
      await syncBoards();
      await reload();
      const p = await listPeople(board.id);
      if (p.ok) setPeople(p.data);
      const a = await boardActivity(board.id);
      if (a.ok) setActivity(a.data);
    })();
  }, [board.id, online, reload]);

  const done = cards.filter((c) => c.status === "done").length;
  const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;

  const nameOf = (id: string) => people.find((p) => p.userId === id)?.displayName ?? t.hubSomeone;

  const add = async () => {
    if (!newTitle.trim()) return;
    await createCard(board.id, newTitle);
    setNewTitle("");
    await reload();
    void syncBoards().then(reload);
  };

  const move = async (card: Card, dir: 1 | -1) => {
    const idx = STATUSES.indexOf(card.status);
    const next = STATUSES[Math.min(STATUSES.length - 1, Math.max(0, idx + dir))];
    if (next === card.status) return;
    await patchCard(card.id, { status: next });
    await reload();
    void syncBoards().then(reload);
  };

  const setStatus = async (card: Card, status: CardStatus) => {
    if (card.status === status) return;
    await patchCard(card.id, { status });
    await reload();
    void syncBoards().then(reload);
  };

  const activityLine = (a: ActivityEntry) => {
    const who = a.actorName ?? t.hubSomeone;
    const what = a.cardTitle ?? "";
    if (a.kind === "card_added") return t.hubActAdded(who, what);
    if (a.kind === "card_deleted") return t.hubActDeleted(who, what);
    return t.hubActStatus(who, what, statusLabel((a.detail as CardStatus) ?? "todo"));
  };

  const cardRow = (c: Card) => (
    <button key={c.id} className="board-card" onClick={() => setOpenCard(c)}>
      <span
        className={`board-check st-${c.status}`}
        role="button"
        tabIndex={0}
        aria-label={statusLabel(c.status)}
        onClick={(e) => {
          e.stopPropagation();
          void move(c, c.status === "done" ? -1 : 1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            void move(c, c.status === "done" ? -1 : 1);
          }
        }}
      >
        {c.status === "done" ? "✓" : c.status === "doing" ? "◐" : ""}
      </span>
      <span className="board-card-body">
        <span className={`fw7 fs14${c.status === "done" ? " done" : ""}`}>{c.title}</span>
        <span className="board-card-meta fs12 sub">
          {c.dueDate && <span className="due-badge">{c.dueDate}</span>}
          {c.assignees.map((u) => (
            <span key={u} className="hub-chip tiny">{nameOf(u)}</span>
          ))}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="top-row">
        <button className="icon-btn small" onClick={() => void onBack()} aria-label="geri">‹</button>
        <div className="fs20 fw8" style={{ flex: 1 }}>{board.name}</div>
        <button className="hub-chip" disabled={!online} onClick={() => setShowMembers(true)}>{t.hubMembers}</button>
      </div>

      <div className="seg">
        <button
          className={view === "list" ? "active" : ""}
          onClick={() => {
            setView("list");
            void setBoardView(board.id, "list");
          }}
        >
          {t.hubViewList}
        </button>
        <button
          className={view === "kanban" ? "active" : ""}
          onClick={() => {
            setView("kanban");
            void setBoardView(board.id, "kanban");
          }}
        >
          {t.hubViewKanban}
        </button>
      </div>

      {pending > 0 && (
        <div className="hub-note" role="status">
          <div className="fs13">{t.hubPending(pending)}</div>
          <button
            className="set-btn"
            disabled={!online}
            onClick={async () => {
              await syncBoards();
              await reload();
            }}
          >
            {t.hubRetrySync}
          </button>
        </div>
      )}

      <div className="board-progress">
        <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
        <div className="fs12 sub">{t.hubProgress(done, cards.length)}</div>
      </div>

      {cards.length === 0 && <div className="fs13 sub">{t.hubNoCards}</div>}

      {view === "list" ? (
        <div className="board-list">{cards.map(cardRow)}</div>
      ) : (
        <div className="kanban">
          {STATUSES.map((st) => (
            <div
              key={st}
              className="kanban-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const c = cards.find((x) => x.id === dragId);
                setDragId(null);
                if (c) void setStatus(c, st);
              }}
            >
              <div className="kanban-head fs12 fw8">
                {statusLabel(st)} · {cards.filter((c) => c.status === st).length}
              </div>
              {cards
                .filter((c) => c.status === st)
                .map((c) => (
                  <div key={c.id} draggable onDragStart={() => setDragId(c.id)} onDragEnd={() => setDragId(null)}>
                    {cardRow(c)}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t.hubCardTitle}
          value={newTitle}
          maxLength={200}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button className="set-btn" disabled={!newTitle.trim()} onClick={() => void add()}>{t.hubAddCard}</button>
      </div>

      {activity.length > 0 && (
        <div className="set-group">
          <div className="set-title">{t.hubActivity}</div>
          {activity.slice(0, 8).map((a) => (
            <div key={a.id} className="fs12 sub">{activityLine(a)}</div>
          ))}
        </div>
      )}

      {myRole === "owner" && (
        <button className="btn-reset" disabled={!online} onClick={() => setAskDeleteBoard(true)}>
          {t.hubDeleteBoard}
        </button>
      )}

      {askDeleteBoard && (
        <>
          <div className="scrim" onClick={() => setAskDeleteBoard(false)} />
          <div className="sheet" role="dialog">
            <div className="sheet-handle" />
            <div className="fw8 fs17">{t.hubDeleteBoardTitle}</div>
            <div className="fs13 sub">{t.hubDeleteBoardDesc}</div>
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={() => setAskDeleteBoard(false)}>{t.hubCancel}</button>
              <button
                className="btn-primary"
                onClick={async () => {
                  setAskDeleteBoard(false);
                  const res = await deleteBoard(board.id);
                  if (!res.ok) showToast(t.hubDeleteBoard, t.hubOnlyManager);
                  onBack();
                }}
              >
                {t.hubDeleteBoard}
              </button>
            </div>
          </div>
        </>
      )}

      {openCard && (
        <CardSheet
          t={t}
          card={openCard}
          people={people}
          canManage={canManage}
          statusLabel={statusLabel}
          onClose={() => setOpenCard(null)}
          onSaved={async () => {
            setOpenCard(null);
            await reload();
            void syncBoards().then(reload);
          }}
          showToast={showToast}
        />
      )}

      {showMembers && (
        <MembersSheet
          t={t}
          board={board}
          people={people}
          canManage={canManage}
          online={online}
          userId={userId}
          showToast={showToast}
          onClose={() => setShowMembers(false)}
          onChanged={async () => {
            const p = await listPeople(board.id);
            if (p.ok) setPeople(p.data);
          }}
          onLeft={onBack}
        />
      )}
    </>
  );
}

// ======================= kart ayrıntısı ====================================

function CardSheet({
  t,
  card,
  people,
  canManage,
  statusLabel,
  onClose,
  onSaved,
  showToast,
}: {
  t: Dict;
  card: Card;
  people: BoardPerson[];
  canManage: boolean;
  statusLabel: (s: CardStatus) => string;
  onClose: () => void;
  onSaved: () => void;
  showToast: (title: string, body: string) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [due, setDue] = useState(card.dueDate ?? "");
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [assignees, setAssignees] = useState<string[]>(card.assignees);
  const [askDelete, setAskDelete] = useState(false);

  const completedLine = useMemo(() => {
    if (card.status !== "done" || !card.completedBy) return null;
    const who = people.find((p) => p.userId === card.completedBy)?.displayName ?? t.hubSomeone;
    return t.hubCompletedBy(who);
  }, [card, people, t]);

  const save = async () => {
    // Yalnızca DEĞİŞEN alanlar gönderilir: aynı kartı düzenleyen arkadaşının
    // dokunmadığın alanlardaki değişikliği silinmesin.
    const patch: Partial<Card> = {};
    if (title.trim() && title !== card.title) patch.title = title.trim();
    if ((notes || null) !== (card.notes ?? null)) patch.notes = notes || null;
    if ((due || null) !== (card.dueDate ?? null)) patch.dueDate = due || null;
    if (status !== card.status) patch.status = status;
    if (assignees.join(",") !== card.assignees.join(",")) patch.assignees = assignees;
    if (Object.keys(patch).length) await patchCard(card.id, patch);
    onSaved();
  };

  const remove = async () => {
    if (!canManage) {
      showToast(t.hubDeleteCard, t.hubOnlyManager);
      return;
    }
    await deleteCard(card.id);
    onSaved();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={t.hubCardTitle}>
        <div className="sheet-handle" />
        <label className="field-label" htmlFor="card-title">{t.hubCardTitle}</label>
        <input id="card-title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />

        <label className="field-label" htmlFor="card-notes">{t.hubCardNotes}</label>
        <textarea
          id="card-notes"
          className="input note-input"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <label className="field-label" htmlFor="card-due">{t.hubCardDue}</label>
        <input id="card-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />

        <div className="field-label">{t.hubStatusTodo} / {t.hubStatusDoing} / {t.hubStatusDone}</div>
        <div className="seg">
          {STATUSES.map((s) => (
            <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>
              {statusLabel(s)}
            </button>
          ))}
        </div>
        {completedLine && <div className="fs12 sub">{completedLine}</div>}

        {people.length > 0 && (
          <>
            <div className="field-label">{t.hubCardAssignees}</div>
            <div className="hub-chips">
              {people.map((p) => {
                const on = assignees.includes(p.userId);
                return (
                  <button
                    key={p.userId}
                    className={`hub-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      setAssignees((cur) => (on ? cur.filter((u) => u !== p.userId) : [...cur, p.userId]))
                    }
                  >
                    {p.displayName}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn-secondary" onClick={onClose}>{t.hubCancel}</button>
          <button className="btn-primary" onClick={() => void save()}>{t.hubSave}</button>
        </div>
        <button className="btn-reset" onClick={() => setAskDelete(true)}>{t.hubDeleteCard}</button>

        {askDelete && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="fw7 fs14">{t.hubDeleteCardTitle}</div>
            <div className="fs12 sub">{t.hubDeleteCardDesc}</div>
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={() => setAskDelete(false)}>{t.hubCancel}</button>
              <button className="btn-primary" onClick={() => void remove()}>{t.hubDeleteCard}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ======================= üyeler ve davet ===================================

function MembersSheet({
  t,
  board,
  people,
  canManage,
  online,
  userId,
  showToast,
  onClose,
  onChanged,
  onLeft,
}: {
  t: Dict;
  board: Board;
  people: BoardPerson[];
  canManage: boolean;
  online: boolean;
  userId: string;
  showToast: (title: string, body: string) => void;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [connections, setConnections] = useState<Person[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = await listConnections();
      if (c.ok) setConnections(c.data);
    })();
  }, []);

  const roleLabel = (r: string | null) =>
    r === "owner" ? t.hubRoleOwner : r === "admin" ? t.hubRoleAdmin : t.hubRoleMember;

  const add = async (p: Person) => {
    const res = await addMember({ boardId: board.id, userId: p.userId });
    if (res.ok && res.data === "not_connected") showToast(t.hubAddMember, t.hubNotConnectedYet);
    else if (res.ok && res.data === "not_allowed") showToast(t.hubAddMember, t.hubOnlyManager);
    setShowPicker(false);
    onChanged();
  };

  const makeInvite = async () => {
    const res = await createInvite({ boardId: board.id, hours: 48 });
    if (!res.ok) {
      showToast(t.hubInviteCode, res.error === "offline" ? t.hubOnlineNeeded : t.hubOnlyManager);
      return;
    }
    setInvite(res.data);
    showToast(t.hubInviteCode, t.hubInviteCreated);
  };

  const revoke = async () => {
    if (!invite) return;
    await revokeInvite(invite);
    setInvite(null);
    showToast(t.hubInviteCode, t.hubInviteRevoked);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={t.hubMembers}>
        <div className="sheet-handle" />
        <div className="fw8 fs17">{t.hubMembers}</div>

        {people.map((p) => (
          <div key={p.userId} className="set-row">
            <Avatar url={p.avatarUrl} />
            <div className="set-row-text">
              <div className="fw7 fs14">{p.displayName}</div>
              <div className="fs12 sub">{roleLabel(p.role)}</div>
            </div>
            {canManage && p.userId !== userId && (
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="hub-chip"
                  onClick={async () => {
                    await setMemberRole({
                      boardId: board.id,
                      userId: p.userId,
                      role: p.role === "admin" ? "member" : "admin",
                    });
                    onChanged();
                  }}
                >
                  {p.role === "admin" ? t.hubRoleMember : t.hubRoleAdmin}
                </button>
                <button
                  className="hub-chip danger"
                  onClick={async () => {
                    await removeMember({ boardId: board.id, userId: p.userId });
                    onChanged();
                  }}
                >
                  {t.hubRemoveMember}
                </button>
              </div>
            )}
          </div>
        ))}

        {canManage && (
          <>
            <button className="btn-secondary" disabled={!online} onClick={() => setShowPicker((v) => !v)}>
              {t.hubFromConnections}
            </button>
            {showPicker &&
              (connections.length === 0 ? (
                <div className="fs12 sub">{t.hubNoConnections}</div>
              ) : (
                connections
                  .filter((c) => !people.some((p) => p.userId === c.userId))
                  .map((c) => (
                    <button key={c.userId} className="set-row set-link" onClick={() => void add(c)}>
                      <Avatar url={c.avatarUrl} />
                      <div className="set-row-text fw7 fs14">{c.displayName}</div>
                      <span className="set-chev">+</span>
                    </button>
                  ))
              ))}

            <button className="btn-secondary" disabled={!online} onClick={() => void makeInvite()}>
              {t.hubInviteCode}
            </button>
            {invite && (
              <div className="hub-qr">
                <div className="hub-code">{invite}</div>
                <QrCode text={invite} size={180} />
                <button className="btn-reset" onClick={() => void revoke()}>{t.hubInviteRevoke}</button>
              </div>
            )}
          </>
        )}

        <button
          className="btn-reset"
          disabled={!online}
          onClick={async () => {
            await removeMember({ boardId: board.id, userId });
            onClose();
            onLeft();
          }}
        >
          {t.hubLeaveBoard}
        </button>
      </div>
    </>
  );
}
