"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { CardStatus, Settings } from "@/lib/types";
import { ensureMyProfile, updateMyProfile, type Profile, type SocialError } from "@/lib/social/profile";
import {
  ensureMyCode,
  rotateMyCode,
  lookupCode,
  formatCode,
  isValidCode,
  inviteLink,
  type CodeMatch,
} from "@/lib/social/codes";
import { sendRequest } from "@/lib/social/connections";
import { GoogleIcon, PersonIcon, ShareIcon } from "@/components/icons";
import QrCode from "./QrCode";
import QrScanner, { qrScanSupported } from "./QrScanner";
import Avatar from "./Avatar";
import Connections from "./Connections";
import Boards from "./Boards";
import Assigned from "./Assigned";

// "Bağlantılar ve Panolar" merkezi. Alt çubuğun ortasındaki GMT logosuyla
// açılır ve üç sekmeden oluşur: Bağlantılar · Panolar · Bana Atananlar.
//
// Devamsızlık verisine HİÇ dokunmaz. Profil, kod ve bağlantı işlemleri
// çevrimiçi çalışır (başkasına gösterilen bilgi, yerelde bekletilmiyor);
// panolar ve kartlar ise çevrimdışı da çalışır ve kuyrukla senkronlanır.

const YEARS = [0, 1, 2, 3, 4, 5, 6];
type HubTab = "connections" | "boards" | "assigned";

export default function Hub({
  t,
  settings,
  online,
  onLogin,
  showToast,
  initialCode,
  onInviteConsumed,
}: {
  t: Dict;
  settings: Settings;
  online: boolean;
  onLogin: () => void;
  showToast: (title: string, body: string) => void;
  initialCode?: string | null;
  onInviteConsumed?: () => void;
}) {
  const [tab, setTab] = useState<HubTab>("connections");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<SocialError | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [year, setYear] = useState<number | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [rotateAsk, setRotateAsk] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [match, setMatch] = useState<(CodeMatch & { relation?: string }) | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [inviteHandled, setInviteHandled] = useState(false);
  // Bağlantı listesini tazelemek için: istek gönderilince/kabul edilince artar.
  const [refreshKey, setRefreshKey] = useState(0);

  const signedIn = !settings.isGuest && !!settings.userId;

  const load = useCallback(async () => {
    if (!signedIn || !settings.userId) return;
    setLoading(true);
    setError(null);
    const res = await ensureMyProfile(settings.userId, settings.userName ?? null, settings.avatarUrl ?? null);
    if (res.ok) {
      setProfile(res.data);
      const code = await ensureMyCode();
      if (code.ok) setMyCode(code.data);
      else setError(code.error);
    } else {
      setError(res.error);
    }
    setLoading(false);
    setLoadedOnce(true);
  }, [signedIn, settings.userId, settings.userName, settings.avatarUrl]);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const find = useCallback(
    async (raw: string) => {
      if (!isValidCode(raw)) {
        setMatch(null);
        setFindMsg(t.hubCodeInvalid);
        return;
      }
      setFinding(true);
      setFindMsg(null);
      setMatch(null);
      const res = await lookupCode(raw, myCode);
      setFinding(false);
      if (!res.ok) {
        setFindMsg(res.error === "offline" ? t.hubOffline : res.error === "notReady" ? t.hubNotReady : t.hubFailed);
        return;
      }
      if (res.data.kind === "found") setMatch(res.data.match);
      else if (res.data.kind === "self") setFindMsg(t.hubSelfCode);
      else if (res.data.kind === "rateLimited") setFindMsg(t.hubRateLimited);
      else setFindMsg(t.hubNotFound);
    },
    [myCode, t],
  );

  // Davet linkiyle gelindiyse kodu kutuya HEMEN yaz.
  useEffect(() => {
    if (!initialCode || !signedIn) return;
    setTab("connections");
    setCodeInput(formatCode(initialCode));
  }, [initialCode, signedIn]);

  useEffect(() => {
    if (!initialCode || !signedIn || !online || !loadedOnce || inviteHandled) return;
    setInviteHandled(true);
    void find(initialCode);
    onInviteConsumed?.();
  }, [initialCode, signedIn, online, loadedOnce, inviteHandled, find, onInviteConsumed]);

  const statusLabel = (s: CardStatus) =>
    s === "todo" ? t.hubStatusTodo : s === "doing" ? t.hubStatusDoing : t.hubStatusDone;

  if (!signedIn) {
    return (
      <div className="scr">
        <div className="top-row">
          <div className="fs22 fw8">{t.hubTitle}</div>
        </div>
        <div className="hub-guest">
          <span className="hub-guest-ic"><PersonIcon /></span>
          <div className="fw8 fs18">{t.hubGuestTitle}</div>
          <div className="fs14 sub">{t.hubGuestDesc}</div>
          <div className="fs12 sub">{t.hubGuestSafe}</div>
          <button className="btn-primary hub-guest-btn" onClick={onLogin}>
            <GoogleIcon /> {t.googleLogin}
          </button>
        </div>
      </div>
    );
  }

  const startEdit = () => {
    if (!profile) return;
    setName(profile.displayName);
    setDept(profile.department ?? "");
    setYear(profile.classYear);
    setEditing(true);
  };

  const save = async () => {
    if (!settings.userId || !name.trim()) return;
    setSaving(true);
    const res = await updateMyProfile(settings.userId, { displayName: name, department: dept, classYear: year });
    setSaving(false);
    if (res.ok) {
      setProfile(res.data);
      setEditing(false);
      showToast(t.hubMyProfile, t.hubSaved);
    } else {
      showToast(t.hubMyProfile, res.error === "offline" ? t.hubOffline : t.hubFailed);
    }
  };

  const copyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(inviteLink(myCode));
      showToast(t.hubMyCode, t.hubCopied);
    } catch {
      showToast(t.hubMyCode, t.hubFailed);
    }
  };

  const shareCode = async () => {
    if (!myCode) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (!nav.share) {
      void copyCode();
      return;
    }
    try {
      await nav.share({ text: t.hubShareText(myCode), url: inviteLink(myCode) });
    } catch {
      /* kullanıcı vazgeçti */
    }
  };

  const rotate = async () => {
    setRotateAsk(false);
    const res = await rotateMyCode();
    if (res.ok) {
      setMyCode(res.data);
      showToast(t.hubMyCode, t.hubRotated);
    } else {
      showToast(t.hubMyCode, res.error === "offline" ? t.hubOffline : t.hubFailed);
    }
  };

  const onScanned = (text: string) => {
    setScanning(false);
    let code = text;
    try {
      const u = new URL(text);
      code = u.searchParams.get("c") ?? text;
    } catch {
      /* link değil, düz kod */
    }
    setCodeInput(formatCode(code));
    void find(code);
  };

  const askConnect = async () => {
    if (!match) return;
    const res = await sendRequest(match.userId);
    if (!res.ok) {
      showToast(t.hubAddPerson, res.error === "offline" ? t.hubOffline : t.hubFailed);
      return;
    }
    if (res.data === "connected") {
      showToast(t.hubAddPerson, t.hubNowConnected(match.displayName));
      setMatch({ ...match, relation: "connected" });
    } else if (res.data === "already") {
      showToast(t.hubAddPerson, t.hubAlreadyConnected);
      setMatch({ ...match, relation: "connected" });
    } else if (res.data === "blocked") {
      showToast(t.hubAddPerson, t.hubBlockedResult);
    } else {
      showToast(t.hubAddPerson, t.hubRequestSent);
      setMatch({ ...match, relation: "outgoing" });
    }
    setRefreshKey((k) => k + 1);
  };

  const yearLabel = (n: number) => (n === 0 ? t.gradePrep : t.gradeNth(n));
  const subline = profile
    ? [profile.department, profile.classYear != null ? yearLabel(profile.classYear) : null].filter(Boolean).join(" · ")
    : "";

  const matchButton = () => {
    const rel = match?.relation ?? "none";
    if (rel === "connected") return <span className="hub-soon">{t.hubConnected}</span>;
    if (rel === "outgoing") return <span className="hub-soon">{t.hubOutgoing}</span>;
    if (rel === "incoming") return <span className="hub-soon">{t.hubIncoming}</span>;
    return (
      <button className="set-btn" disabled={!online} onClick={() => void askConnect()}>
        {t.hubSendRequest}
      </button>
    );
  };

  if (scanning) {
    return <QrScanner t={t} onResult={onScanned} onClose={() => setScanning(false)} />;
  }

  return (
    <div className="scr">
      <div className="top-row">
        <div className="fs22 fw8">{t.hubTitle}</div>
      </div>

      <div className="seg">
        <button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}>
          {t.hubTabConnections}
        </button>
        <button className={tab === "boards" ? "active" : ""} onClick={() => setTab("boards")}>
          {t.hubTabBoards}
        </button>
        <button className={tab === "assigned" ? "active" : ""} onClick={() => setTab("assigned")}>
          {t.hubTabAssigned}
        </button>
      </div>

      {(!online || error) && tab === "connections" && (
        <div className="hub-note" role="status">
          <div className="fs13">
            {!online || error === "offline" ? t.hubOffline : error === "notReady" ? t.hubNotReady : t.hubFailed}
          </div>
          {online && error && error !== "notReady" && (
            <button className="set-btn" onClick={() => void load()}>{t.hubRetry}</button>
          )}
        </div>
      )}

      {tab === "connections" && (
        <>
          {/* ---- Profil ---- */}
          <div className="set-group">
            <div className="set-title">{t.hubMyProfile}</div>
            {loading && !profile && <div className="fs13 sub">{t.hubLoading}</div>}

            {profile && !editing && (
              <div className="set-row">
                <Avatar url={profile.avatarUrl} />
                <div className="set-row-text">
                  <div className="fw7 fs14">{profile.displayName}</div>
                  {subline && <div className="fs12 sub">{subline}</div>}
                </div>
                <button className="set-btn" onClick={startEdit} disabled={!online}>{t.hubEdit}</button>
              </div>
            )}

            {profile && editing && (
              <div className="stack" style={{ gap: 10 }}>
                <label className="field-label" htmlFor="hub-name">{t.hubNameLabel}</label>
                <input id="hub-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <label className="field-label" htmlFor="hub-dept">{t.hubDeptLabel}</label>
                <input
                  id="hub-dept"
                  className="input"
                  value={dept}
                  maxLength={80}
                  placeholder={t.hubDeptPlaceholder}
                  onChange={(e) => setDept(e.target.value)}
                />
                <div className="field-label">{t.hubYearLabel}</div>
                <div className="hub-chips" role="group" aria-label={t.hubYearLabel}>
                  <button className={`hub-chip${year === null ? " on" : ""}`} aria-pressed={year === null} onClick={() => setYear(null)}>
                    {t.gradeUnset}
                  </button>
                  {YEARS.map((n) => (
                    <button key={n} className={`hub-chip${year === n ? " on" : ""}`} aria-pressed={year === n} onClick={() => setYear(n)}>
                      {yearLabel(n)}
                    </button>
                  ))}
                </div>
                <div className="sheet-actions">
                  <button className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>{t.hubCancel}</button>
                  <button className="btn-primary" onClick={() => void save()} disabled={saving || !name.trim() || !online}>
                    {t.hubSave}
                  </button>
                </div>
              </div>
            )}

            <div className="fs12 sub">{t.hubProfilePrivacy}</div>
          </div>

          {/* ---- Bağlantı kodu ---- */}
          <div className="set-group">
            <div className="set-title">{t.hubMyCode}</div>
            {myCode ? (
              <>
                <div className="hub-code" aria-label={t.hubMyCode}>{myCode}</div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn-secondary hub-act" onClick={() => void copyCode()}>{t.hubCopy}</button>
                  <button className="btn-secondary hub-act" onClick={() => void shareCode()}>
                    <ShareIcon /> {t.hubShare}
                  </button>
                  <button className="btn-secondary hub-act" onClick={() => setShowQr((v) => !v)}>
                    {showQr ? t.hubHideQr : t.hubShowQr}
                  </button>
                </div>
                {showQr && (
                  <div className="hub-qr">
                    <QrCode text={inviteLink(myCode)} />
                    <div className="fs12 sub">{t.hubQrHint}</div>
                  </div>
                )}
                <div className="fs12 sub">{t.hubCodeDesc}</div>
                <button className="btn-reset" onClick={() => setRotateAsk(true)} disabled={!online}>{t.hubRotate}</button>
              </>
            ) : (
              <div className="fs13 sub">{loading ? t.hubLoading : t.hubOffline}</div>
            )}
          </div>

          {/* ---- Kişi ekleme ---- */}
          <div className="set-group">
            <div className="set-title">{t.hubAddPerson}</div>
            <div className="fs12 sub">{t.hubAddDesc}</div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={codeInput}
                placeholder={t.hubCodePlaceholder}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void find(codeInput);
                }}
              />
              <button className="set-btn" onClick={() => void find(codeInput)} disabled={finding || !online}>
                {t.hubFind}
              </button>
            </div>
            {qrScanSupported() && (
              <button className="btn-secondary" onClick={() => setScanning(true)} disabled={!online}>{t.hubScan}</button>
            )}
            {findMsg && <div className="fs13 sub">{findMsg}</div>}
            {match && (
              <div className="set-row hub-match">
                <Avatar url={match.avatarUrl} />
                <div className="set-row-text">
                  <div className="fw7 fs14">{match.displayName}</div>
                </div>
                {matchButton()}
              </div>
            )}
          </div>

          <Connections
            t={t}
            online={online}
            showToast={showToast}
            refreshKey={refreshKey}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        </>
      )}

      {tab === "boards" && (
        <Boards t={t} online={online} showToast={showToast} userId={settings.userId ?? ""} />
      )}

      {tab === "assigned" && <Assigned t={t} online={online} statusLabel={statusLabel} />}

      {rotateAsk && (
        <>
          <div className="scrim" onClick={() => setRotateAsk(false)} />
          <div className="sheet" role="dialog" aria-label={t.hubRotateTitle}>
            <div className="sheet-handle" />
            <div className="fw8 fs17">{t.hubRotateTitle}</div>
            <div className="fs13 sub">{t.hubRotateDesc}</div>
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={() => setRotateAsk(false)}>{t.hubCancel}</button>
              <button className="btn-primary" onClick={() => void rotate()}>{t.hubRotateConfirm}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
