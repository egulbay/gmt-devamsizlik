"use client";

import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { CardStatus } from "@/lib/types";
import { assignedToMe, type AssignedCard } from "@/lib/social/boards";

// Tüm panolardaki, sana atanmış ve henüz bitmemiş kartlar tek listede.
// Kaynak sunucudur: başka bir panodaki kart bu cihaza hiç inmemiş olabilir.
export default function Assigned({
  t,
  online,
  statusLabel,
}: {
  t: Dict;
  online: boolean;
  statusLabel: (s: CardStatus) => string;
}) {
  const [cards, setCards] = useState<AssignedCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!online) return;
      const res = await assignedToMe();
      if (res.ok) setCards(res.data);
      setLoaded(true);
    })();
  }, [online]);

  if (!online) return <div className="hub-note fs13">{t.hubOnlineNeeded}</div>;
  if (!loaded) return <div className="fs13 sub">{t.hubLoading}</div>;
  if (cards.length === 0) return <div className="fs13 sub">{t.hubAssignedEmpty}</div>;

  // Pano pano gruplanıyor: aynı panodaki işler bir arada dursun.
  const byBoard = new Map<string, AssignedCard[]>();
  for (const c of cards) byBoard.set(c.boardId, [...(byBoard.get(c.boardId) ?? []), c]);

  return (
    <>
      {[...byBoard.values()].map((group) => (
        <div key={group[0].boardId} className="set-group">
          <div className="set-title">{group[0].boardName}</div>
          {group.map((c) => (
            <div key={c.cardId} className="set-row">
              <div className="set-row-text">
                <div className="fw7 fs14">{c.title}</div>
                <div className="fs12 sub">
                  {statusLabel(c.status)}
                  {c.dueDate ? ` · ${c.dueDate}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
