"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import {
  listConnections,
  listRequests,
  listBlocks,
  respondRequest,
  cancelRequest,
  removeConnection,
  blockUser,
  unblockUser,
  type PendingRequest,
  type Person,
} from "@/lib/social/connections";
import Avatar from "./Avatar";

// Bekleyen istekler, bağlantı listesi ve engellenenler.
// Kabul edilene kadar karşı tarafın YALNIZCA adı ve fotoğrafı görünür;
// bölüm/sınıf bağlantı kurulunca gelir (sunucu kuralı, migration 009).

export default function Connections({
  t,
  online,
  showToast,
  refreshKey,
  onChanged,
}: {
  t: Dict;
  online: boolean;
  showToast: (title: string, body: string) => void;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ kind: "remove" | "block"; person: Person } | null>(null);

  const load = useCallback(async () => {
    if (!online) return;
    const [r, c, b] = await Promise.all([listRequests(), listConnections(), listBlocks()]);
    if (r.ok) setRequests(r.data);
    if (c.ok) setPeople(c.data);
    if (b.ok) setBlocked(b.data);
  }, [online]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const yearLabel = (n: number) => (n === 0 ? t.gradePrep : t.gradeNth(n));
  const sub = (p: Person) =>
    [p.department, p.classYear != null ? yearLabel(p.classYear) : null].filter(Boolean).join(" · ");

  const answer = async (req: PendingRequest, accept: boolean) => {
    setBusy(req.id);
    const res = await respondRequest(req.id, accept);
    setBusy(null);
    if (res.ok && res.data === "accepted") showToast(t.hubRequests, t.hubNowConnected(req.displayName));
    await load();
    onChanged();
  };

  const withdraw = async (req: PendingRequest) => {
    setBusy(req.id);
    await cancelRequest(req.id);
    setBusy(null);
    await load();
    onChanged();
  };

  const confirmAsk = async () => {
    if (!ask) return;
    const { kind, person } = ask;
    setAsk(null);
    const res = kind === "remove" ? await removeConnection(person.userId) : await blockUser(person.userId);
    if (!res.ok) showToast(t.hubConnectionsList, res.error === "offline" ? t.hubOffline : t.hubFailed);
    await load();
    onChanged();
  };

  return (
    <>
      {/* ---- Bekleyen istekler ---- */}
      <div className="set-group">
        <div className="set-title">{t.hubRequests}</div>
        {requests.length === 0 && <div className="fs13 sub">{t.hubNoRequests}</div>}
        {requests.map((r) => (
          <div key={r.id} className="set-row">
            <Avatar url={r.avatarUrl} />
            <div className="set-row-text">
              <div className="fw7 fs14">{r.displayName}</div>
              <div className="fs12 sub">{r.direction === "incoming" ? t.hubIncoming : t.hubOutgoing}</div>
            </div>
            {r.direction === "incoming" ? (
              <div className="row" style={{ gap: 6 }}>
                <button className="set-btn" disabled={busy === r.id || !online} onClick={() => void answer(r, true)}>
                  {t.hubAccept}
                </button>
                <button className="hub-chip" disabled={busy === r.id || !online} onClick={() => void answer(r, false)}>
                  {t.hubDecline}
                </button>
              </div>
            ) : (
              <button className="hub-chip" disabled={busy === r.id || !online} onClick={() => void withdraw(r)}>
                {t.hubCancelRequest}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ---- Bağlantılar ---- */}
      <div className="set-group">
        <div className="set-title">{t.hubConnectionsList}</div>
        {people.length === 0 && <div className="fs13 sub">{t.hubNoConnections}</div>}
        {people.map((p) => (
          <div key={p.userId} className="set-row">
            <Avatar url={p.avatarUrl} />
            <div className="set-row-text">
              <div className="fw7 fs14">{p.displayName}</div>
              {sub(p) && <div className="fs12 sub">{sub(p)}</div>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="hub-chip" disabled={!online} onClick={() => setAsk({ kind: "remove", person: p })}>
                {t.hubRemove}
              </button>
              <button className="hub-chip danger" disabled={!online} onClick={() => setAsk({ kind: "block", person: p })}>
                {t.hubBlock}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Engellenenler (varsa) ---- */}
      {blocked.length > 0 && (
        <div className="set-group">
          <button className="set-row set-link" onClick={() => setShowBlocked((v) => !v)}>
            <div className="set-row-text fw7 fs14">
              {t.hubBlocked} ({blocked.length})
            </div>
            <span className="set-chev">{showBlocked ? "⌄" : "›"}</span>
          </button>
          {showBlocked &&
            blocked.map((p) => (
              <div key={p.userId} className="set-row">
                <Avatar url={p.avatarUrl} />
                <div className="set-row-text fw7 fs14">{p.displayName}</div>
                <button
                  className="hub-chip"
                  disabled={!online}
                  onClick={async () => {
                    await unblockUser(p.userId);
                    await load();
                  }}
                >
                  {t.hubUnblock}
                </button>
              </div>
            ))}
        </div>
      )}

      {ask && (
        <>
          <div className="scrim" onClick={() => setAsk(null)} />
          <div className="sheet" role="dialog">
            <div className="sheet-handle" />
            <div className="fw8 fs17">
              {ask.kind === "remove" ? t.hubRemoveTitle(ask.person.displayName) : t.hubBlockTitle(ask.person.displayName)}
            </div>
            <div className="fs13 sub">{ask.kind === "remove" ? t.hubRemoveDesc : t.hubBlockDesc}</div>
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={() => setAsk(null)}>{t.hubCancel}</button>
              <button className="btn-primary" onClick={() => void confirmAsk()}>
                {ask.kind === "remove" ? t.hubRemove : t.hubBlock}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
