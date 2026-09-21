"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { Settings } from "@/lib/types";
import { ensureMyProfile, updateMyProfile, type Profile, type SocialError } from "@/lib/social/profile";
import { GoogleIcon, PersonIcon, ProjectsIcon } from "@/components/icons";

// "Bağlantılar ve Panolar" merkezi. Alt çubuğun ortasındaki GMT logosuyla
// açılır. Devamsızlık verisine HİÇ dokunmaz; yalnızca sosyal tablolarla
// (profiles, ileride bağlantılar/panolar) konuşur.
//
// Bu bölüm bilerek çevrimiçi çalışır: profil başkalarına gösterilecek bilgi
// olduğu için yerelde bekletip sonra göndermek yerine anında kaydediliyor.

const YEARS = [0, 1, 2, 3, 4, 5, 6];

export default function Hub({
  t,
  settings,
  online,
  onLogin,
  showToast,
}: {
  t: Dict;
  settings: Settings;
  online: boolean;
  onLogin: () => void;
  showToast: (title: string, body: string) => void;
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

  const signedIn = !settings.isGuest && !!settings.userId;

  const load = useCallback(async () => {
    if (!signedIn || !settings.userId) return;
    setLoading(true);
    setError(null);
    const res = await ensureMyProfile(settings.userId, settings.userName ?? null, settings.avatarUrl ?? null);
    setLoading(false);
    if (res.ok) setProfile(res.data);
    else setError(res.error);
  }, [signedIn, settings.userId, settings.userName, settings.avatarUrl]);

  // İlk açılışta ve internet geri geldiğinde yükle.
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

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
    const res = await updateMyProfile(settings.userId, {
      displayName: name,
      department: dept,
      classYear: year,
    });
    setSaving(false);
    if (res.ok) {
      setProfile(res.data);
      setEditing(false);
      showToast(t.hubMyProfile, t.hubSaved);
    } else {
      showToast(t.hubMyProfile, res.error === "offline" ? t.hubOffline : t.hubFailed);
    }
  };

  const yearLabel = (n: number) => (n === 0 ? t.gradePrep : t.gradeNth(n));
  const subline = profile
    ? [profile.department, profile.classYear != null ? yearLabel(profile.classYear) : null].filter(Boolean).join(" · ")
    : "";

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
            <input
              id="hub-name"
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
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

      <div className="set-group">
        <div className="set-title">{t.hubConnections}</div>
        <div className="set-row">
          <span className="set-ic"><PersonIcon /></span>
          <div className="set-row-text">
            <div className="fs13 sub">{t.hubConnectionsSoon}</div>
          </div>
          <span className="hub-soon">{t.hubSoon}</span>
        </div>
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
    </div>
  );
}
