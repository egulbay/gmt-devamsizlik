"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { Settings } from "@/lib/types";
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
import { GoogleIcon, PersonIcon, ProjectsIcon, ShareIcon } from "@/components/icons";
import QrCode from "./QrCode";
import QrScanner, { qrScanSupported } from "./QrScanner";

// "Bağlantılar ve Panolar" merkezi. Alt çubuğun ortasındaki GMT logosuyla
// açılır. Devamsızlık verisine HİÇ dokunmaz; yalnızca sosyal tablolarla
// (profiles, connection_codes, ileride panolar) konuşur.
//
// Bu bölüm bilerek çevrimiçi çalışır: profil ve kod başkalarına gösterilen
// bilgi olduğu için yerelde bekletip sonra göndermek yerine anında kaydedilir.

const YEARS = [0, 1, 2, 3, 4, 5, 6];

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<SocialError | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [year, setYear] = useState<number | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [rotateAsk, setRotateAsk] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [match, setMatch] = useState<CodeMatch | null>(null);
  const [matchAvatarFailed, setMatchAvatarFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Merkez bir kez yüklendi mi (profil + kod denendi). Davet linki bunu bekler.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [inviteHandled, setInviteHandled] = useState(false);

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

  // İlk açılışta ve internet geri geldiğinde yükle.
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
      if (res.data.kind === "found") {
        setMatchAvatarFailed(false);
        setMatch(res.data.match);
      } else if (res.data.kind === "self") setFindMsg(t.hubSelfCode);
      else if (res.data.kind === "rateLimited") setFindMsg(t.hubRateLimited);
      else setFindMsg(t.hubNotFound);
    },
    [myCode, t],
  );

  // Davet linkiyle gelindiyse kodu kutuya HEMEN yaz: kendi kodumuz
  // yüklenemese bile kullanıcı kodu görsün ve elle deneyebilsin.
  useEffect(() => {
    if (!initialCode || !signedIn) return;
    setCodeInput(formatCode(initialCode));
  }, [initialCode, signedIn]);

  // Arama, merkez bir kez yüklendikten sonra çalışır (kendi kodumuz o sırada
  // biliniyorsa "bu senin kodun" uyarısını da verebiliriz).
  useEffect(() => {
    if (!initialCode || !signedIn || !online || !loadedOnce || inviteHandled) return;
    setInviteHandled(true);
    void find(initialCode);
    onInviteConsumed?.();
  }, [initialCode, signedIn, online, loadedOnce, inviteHandled, find, onInviteConsumed]);

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
    // QR'ın içinde davet linki var; kod parametresini ayıkla. Elle yazılmış
    // düz kod da kabul edilir.
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

  const yearLabel = (n: number) => (n === 0 ? t.gradePrep : t.gradeNth(n));
  const subline = profile
    ? [profile.department, profile.classYear != null ? yearLabel(profile.classYear) : null].filter(Boolean).join(" · ")
    : "";

  if (scanning) {
    return <QrScanner t={t} onResult={onScanned} onClose={() => setScanning(false)} />;
  }

  return (
    <div className="scr">
      <div className="top-row">
        <div className="fs22 fw8">{t.hubTitle}</div>
      </div>

      {(!online || error) && (
        <div className="hub-note" role="status">
          <div className="fs13">
            {!online || error === "offline" ? t.hubOffline : error === "notReady" ? t.hubNotReady : t.hubFailed}
          </div>
          {online && error && error !== "notReady" && (
            <button className="set-btn" onClick={() => void load()}>{t.hubRetry}</button>
          )}
        </div>
      )}

      <div className="set-group">
        <div className="set-title">{t.hubMyProfile}</div>
        {loading && !profile && <div className="fs13 sub">{t.hubLoading}</div>}

        {profile && !editing && (
          <div className="set-row">
            {profile.avatarUrl && !avatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="set-avatar"
                src={profile.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span className="set-ic"><PersonIcon /></span>
            )}
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
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(false)} disabled={saving}>
                {t.hubCancel}
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => void save()} disabled={saving || !name.trim() || !online}>
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
            {match.avatarUrl && !matchAvatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="set-avatar"
                src={match.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setMatchAvatarFailed(true)}
              />
            ) : (
              <span className="set-ic"><PersonIcon /></span>
            )}
            <div className="set-row-text">
              <div className="fw7 fs14">{match.displayName}</div>
              <div className="fs12 sub">{t.hubRequestSoon}</div>
            </div>
            <button className="set-btn" disabled>{t.hubSendRequest}</button>
          </div>
        )}
      </div>

      <div className="set-group">
        <div className="set-title">{t.hubBoards}</div>
        <div className="set-row">
          <span className="set-ic"><ProjectsIcon /></span>
          <div className="set-row-text">
            <div className="fs13 sub">{t.hubBoardsSoon}</div>
          </div>
          <span className="hub-soon">{t.hubSoon}</span>
        </div>
      </div>

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
