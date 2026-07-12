"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tf, MONTHS } from "@/lib/i18n";
import { ratioColor } from "@/lib/color";
import type { AbsenceRecord, Course, Lang, Semester, Settings, SyncState, Theme } from "@/lib/types";
import * as repo from "@/lib/db/repo";
import { isCloudEnabled, supabase } from "@/lib/sync/supabaseClient";
import { initSync, onSyncState, flushSyncQueue, pullRemote } from "@/lib/sync/syncEngine";
import {
  registerServiceWorker,
  requestNotificationPermission,
  permission as notifPermission,
  evaluateNotifications,
  notificationsSupported,
} from "@/lib/notifications";
import { buildTextSummary, shareText, printSummary, type CourseExport } from "@/lib/export";
import { Calendar } from "./Calendar";
import { GoogleIcon, MoonIcon, PersonIcon, ShareIcon, SunIcon, TrashIcon } from "./icons";

type Screen = "login" | "guestName" | "home" | "detail";
type SortMode = "default" | "near" | "name";

interface CourseVM extends Course {
  used: number;
  remaining: number;
  ratio: number;
  warn: boolean;
  warnClass: "mid" | "high";
}

function computeVM(c: Course, records: AbsenceRecord[]): CourseVM {
  const used = records.reduce((a, r) => a + r.hours, 0);
  const remaining = c.totalHours - used;
  const ratio = c.totalHours > 0 ? used / c.totalHours : 0;
  return { ...c, used, remaining, ratio, warn: ratio >= 0.7, warnClass: ratio >= 1 ? "high" : "mid" };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [screen, setScreen] = useState<Screen>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<"active" | "past">("active");

  const [activeVMs, setActiveVMs] = useState<CourseVM[]>([]);
  const [recordsByCourse, setRecordsByCourse] = useState<Record<string, AbsenceRecord[]>>({});
  const [archivedSemesters, setArchivedSemesters] = useState<Semester[]>([]);
  const [archivedCourses, setArchivedCourses] = useState<Record<string, CourseVM[]>>({});
  const [expandedSem, setExpandedSem] = useState<string | null>(null);

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");

  const [guestNameInput, setGuestNameInput] = useState("");

  // sheets
  const [courseSheet, setCourseSheet] = useState<{ editId: string | null } | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseHours, setCourseHours] = useState("");
  const [dayPopover, setDayPopover] = useState<{ date: string; hours: number; recordId?: string } | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clearRecordsConfirm, setClearRecordsConfirm] = useState(false);
  // Course pending deletion (its id), shown via a confirm sheet. Set from the
  // detail edit-sheet OR from long-press "jiggle" mode on the home list.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // iOS-style edit mode: long-press a course card to make the list jiggle and
  // reveal a delete (×) badge on each card.
  const [jiggle, setJiggle] = useState(false);
  const [semesterSheet, setSemesterSheet] = useState(false);
  const [semesterName, setSemesterName] = useState("");
  const [exportSheet, setExportSheet] = useState<{ scope: "course" | "all" } | null>(null);

  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");

  const lang: Lang = settings?.lang ?? "tr";
  const theme: Theme = settings?.theme ?? "light";
  const t = tf(lang);

  // ---- data loading -------------------------------------------------------
  const reload = useCallback(async () => {
    const s = await repo.getSettings();
    setSettings(s);
    const active = await repo.listActiveCourses();
    const recMap: Record<string, AbsenceRecord[]> = {};
    const vms: CourseVM[] = [];
    for (const c of active) {
      const recs = await repo.listRecords(c.id);
      recMap[c.id] = recs;
      vms.push(computeVM(c, recs));
    }
    // archived semesters + their courses (for detail + past tab)
    const arch = await repo.listArchivedSemesters();
    const archCourses: Record<string, CourseVM[]> = {};
    for (const sem of arch) {
      const cs = await repo.listCoursesBySemester(sem.id);
      const arr: CourseVM[] = [];
      for (const c of cs) {
        const recs = await repo.listRecords(c.id);
        recMap[c.id] = recs;
        arr.push(computeVM(c, recs));
      }
      archCourses[sem.id] = arr;
    }
    setActiveVMs(vms);
    setRecordsByCourse(recMap);
    setArchivedSemesters(arch);
    setArchivedCourses(archCourses);
  }, []);

  // ---- init ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let authSub: { unsubscribe: () => void } | null = null;
    (async () => {
      await registerServiceWorker();
      const s = await repo.getSettings();
      if (cancelled) return;
      setSettings(s);
      setNotifPerm(notificationsSupported() ? notifPermission() : "denied");

      // If we just landed back from Google/Supabase with an error (e.g. a
      // misconfigured redirect URL, a cancelled consent, or a mismatched
      // client), surface it instead of silently falling back to the login
      // screen — that silence is what made this impossible to diagnose.
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const qs = new URLSearchParams(window.location.search);
        const errDesc =
          hash.get("error_description") ||
          qs.get("error_description") ||
          hash.get("error") ||
          qs.get("error");
        if (errDesc) {
          setAuthError(decodeURIComponent(errDesc).replace(/\+/g, " "));
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch {
        /* ignore */
      }

      // Google OAuth: after returning from Google, the SDK parses the token
      // out of the URL as part of its own auto-initialize() call — which
      // starts the instant the client is constructed, racing our own code.
      // Relying solely on onAuthStateChange to catch that first event is
      // fragile (it depends on subscribing before the SDK's internal init
      // promise resolves). So: register the listener for *future* changes,
      // AND explicitly await getSession() right after — that call itself
      // awaits the SDK's init promise, so it reliably reflects a session
      // parsed from the redirect URL regardless of subscription timing.
      let handledInitialSession = false;
      const applySignedInSession = async (
        u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
        isFreshSignIn: boolean
      ) => {
        const name =
          (u.user_metadata?.full_name as string) ||
          (u.user_metadata?.name as string) ||
          u.email ||
          null;
        if (isFreshSignIn) {
          await repo.migrateGuestToAccount(u.id, name);
          try {
            window.history.replaceState({}, "", window.location.pathname);
          } catch {
            /* ignore */
          }
        } else {
          await repo.patchSettings({ isGuest: false, userId: u.id, userName: name });
        }
        // Pull down any existing cloud data BEFORE the first reload(). reload()
        // derives the active semester locally (ensureActiveSemester), and on a
        // fresh device that local state doesn't know about a semester that
        // only exists in the cloud yet — pulling first means it's already in
        // IndexedDB by the time that derivation runs, instead of a race that
        // orphans previously-synced courses under a freshly-fabricated semester.
        await flushSyncQueue();
        await pullRemote();
        await reload();
        if (cancelled) return;
        setScreen("home");
        setReady(true);
        if (isFreshSignIn) showToast(t.notifDemoTitle, t.welcome(name || ""));
      };

      if (isCloudEnabled()) {
        const client = supabase();
        if (client) {
          const res = client.auth.onAuthStateChange((event, session) => {
            if (!session?.user || handledInitialSession) return;
            handledInitialSession = true;
            setTimeout(() => {
              void applySignedInSession(session.user, event === "SIGNED_IN");
            }, 0);
          });
          authSub = res.data.subscription;

          try {
            const { data, error } = await client.auth.getSession();
            if (error) {
              setAuthError((lang === "tr" ? "Oturum hatası: " : "Session error: ") + error.message);
            } else if (data.session?.user && !handledInitialSession) {
              handledInitialSession = true;
              await applySignedInSession(data.session.user, window.location.hash.includes("access_token"));
            }
          } catch (e) {
            setAuthError((lang === "tr" ? "Oturum hatası: " : "Session error: ") + String(e));
          }
        }
      }

      if (!handledInitialSession) {
        await reload();
        const s2 = await repo.getSettings();
        if (cancelled) return;
        setScreen(s2.userName ? "home" : "login");
        setReady(true);
      }

      initSync();
      onSyncState((st) => setSyncState(st));
    })();
    return () => {
      cancelled = true;
      authSub?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload on data changes coming from sync pulls / cross-tab. Deliberately
  // NOT on "gmt-enqueue": user actions already call reload() themselves, and
  // reload → ensureActiveSemester can itself enqueue — listening to enqueue
  // here created a reload→enqueue→reload feedback loop that livelocked the
  // tab when many queue writes happened in a burst (e.g. the semester repair).
  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("gmt-data-changed", handler);
    return () => {
      window.removeEventListener("gmt-data-changed", handler);
    };
  }, [reload]);

  // Hardware/gesture back button: while on the course detail screen, go back
  // to Derslerim instead of letting the browser navigate away from the PWA.
  useEffect(() => {
    const onPopState = () => {
      setScreen((s) => {
        if (s === "detail") {
          setSelectedCourseId(null);
          return "home";
        }
        return s;
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // apply theme to <html>
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  // run notification checks whenever active data changes
  useEffect(() => {
    if (!ready || !settings) return;
    (async () => {
      const alerts = await evaluateNotifications(
        activeVMs.map((v) => ({ ...v })),
        recordsByCourse,
        lang
      );
      if (alerts.length) {
        showToast(t.notifDemoTitle, alerts[0].body);
        void reload();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVMs.length, ready]);

  const showToast = useCallback((title: string, body: string) => {
    setToast({ title, body });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ---- auth / entry -------------------------------------------------------
  const loginGoogle = async () => {
    if (!isCloudEnabled()) {
      // Cloud not configured → continue locally; still ask for a name.
      showToast(t.notifDemoTitle, lang === "tr"
        ? "Bulut yapılandırılmadı — yerel olarak devam ediliyor."
        : "Cloud not configured — continuing locally.");
      setScreen("guestName");
      return;
    }
    setAuthError(null);
    const client = supabase();
    if (!client) {
      setAuthError(lang === "tr" ? "Bağlantı kurulamadı (yapılandırma yok)." : "Could not connect (no config).");
      return;
    }
    try {
      // Standard flow: let the SDK perform the redirect itself. This is the
      // documented, most broadly-compatible path — it's what supabase-js does
      // internally in every framework's official example.
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setAuthError((lang === "tr" ? "Giriş hatası: " : "Sign-in error: ") + error.message);
      }
    } catch (e) {
      setAuthError((lang === "tr" ? "Giriş hatası: " : "Sign-in error: ") + String(e));
    }
  };

  const loginGuest = () => setScreen("guestName");

  const confirmGuest = async () => {
    const name = guestNameInput.trim();
    if (!name) return;
    await repo.patchSettings({ userName: name, isGuest: true });
    await reload();
    setScreen("home");
    showToast(t.notifDemoTitle, t.welcome(name));
  };

  const goCreateAccount = () => setScreen("login");

  // ---- theme / lang -------------------------------------------------------
  const toggleTheme = async () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setSettings((s) => (s ? { ...s, theme: next } : s));
    await repo.setTheme(next);
  };
  const toggleLang = async () => {
    const next: Lang = lang === "tr" ? "en" : "tr";
    setSettings((s) => (s ? { ...s, lang: next } : s));
    await repo.setLang(next);
  };

  // ---- course actions -----------------------------------------------------
  const openAddCourse = () => {
    setCourseSheet({ editId: null });
    setCourseName("");
    setCourseHours("");
  };
  const openEditCourse = (c: CourseVM) => {
    setCourseSheet({ editId: c.id });
    setCourseName(c.name);
    setCourseHours(String(c.totalHours));
  };
  const canSaveCourse = courseName.trim().length > 0 && parseFloat(courseHours) > 0;
  const saveCourse = async () => {
    const name = courseName.trim();
    const hours = parseFloat(courseHours);
    if (!name || !(hours > 0)) return;
    if (courseSheet?.editId) {
      await repo.updateCourse(courseSheet.editId, { name, totalHours: hours });
    } else {
      await repo.addCourse(name, hours);
    }
    setCourseSheet(null);
    await reload();
  };
  const doDeleteCourse = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    await repo.deleteCourse(id);
    setPendingDeleteId(null);
    setCourseSheet(null);
    setJiggle(false);
    // If we were viewing this course's detail, return home.
    if (selectedCourseId === id) {
      setSelectedCourseId(null);
      setScreen("home");
    }
    await reload();
  };

  const openCourse = (id: string) => {
    setSelectedCourseId(id);
    const d = new Date();
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
    setScreen("detail");
    // Push a history entry so the phone's hardware/gesture back button closes
    // this screen (via popstate below) instead of exiting the whole app.
    window.history.pushState({ gmtScreen: "detail" }, "");
  };

  const closeDetail = () => {
    // Go through history.back() (not a direct setScreen) so our pushed entry
    // gets consumed here rather than lingering for a later back-press to hit.
    if (window.history.state?.gmtScreen === "detail") {
      window.history.back();
    } else {
      setScreen("home");
      setSelectedCourseId(null);
    }
  };

  const prevMonth = () => {
    let m = calMonth - 1;
    let y = calYear;
    if (m < 0) { m = 11; y -= 1; }
    setCalMonth(m);
    setCalYear(y);
  };
  const nextMonth = () => {
    let m = calMonth + 1;
    let y = calYear;
    if (m > 11) { m = 0; y += 1; }
    setCalMonth(m);
    setCalYear(y);
  };

  // ---- records ------------------------------------------------------------
  const openDay = (dateKey: string, existing?: AbsenceRecord) => {
    setDayPopover({ date: dateKey, hours: existing ? existing.hours : 1, recordId: existing?.id });
  };
  const saveDay = async () => {
    if (!dayPopover || !selectedCourseId) return;
    const h = dayPopover.hours;
    if (!(h > 0)) return;
    await repo.setRecord(selectedCourseId, dayPopover.date, h, dayPopover.recordId);
    setDayPopover(null);
    await reload();
  };
  const deleteDay = async () => {
    if (!dayPopover?.recordId) {
      setDayPopover(null);
      return;
    }
    await repo.deleteRecord(dayPopover.recordId);
    setDayPopover(null);
    await reload();
  };
  const deleteRecordDirect = async (recordId: string) => {
    await repo.deleteRecord(recordId);
    await reload();
  };

  // ---- reset / clear ------------------------------------------------------
  const doReset = async () => {
    await repo.resetProfile();
    setResetConfirm(false);
    setSelectedCourseId(null);
    setGuestNameInput("");
    await reload();
    setScreen("login");
  };
  const doClearRecords = async () => {
    if (!selectedCourseId) return;
    await repo.clearRecordsForCourse(selectedCourseId);
    setClearRecordsConfirm(false);
    await reload();
  };

  // ---- semester -----------------------------------------------------------
  const startSemester = async () => {
    await repo.startNewSemester(semesterName);
    setSemesterSheet(false);
    setSemesterName("");
    setHomeTab("active");
    await reload();
  };

  // ---- notifications ------------------------------------------------------
  const onBell = async () => {
    let perm = notifPerm;
    if (notificationsSupported() && perm !== "granted") {
      perm = await requestNotificationPermission();
      setNotifPerm(perm);
      await repo.patchSettings({ notificationsEnabled: perm === "granted" });
    }
    const alerts = await evaluateNotifications(
      activeVMs.map((v) => ({ ...v })),
      recordsByCourse,
      lang
    );
    await reload();
    if (alerts.length) {
      showToast(t.notifDemoTitle, alerts[0].body);
    } else {
      // Give feedback: show the closest-to-limit course, else "all good".
      const near = [...activeVMs].sort((a, b) => b.ratio - a.ratio)[0];
      const body =
        near && near.warn
          ? lang === "tr"
            ? `"${near.name}" dersinde ${near.remaining <= 0 ? "0" : near.remaining} saat hakkın kaldı.`
            : `You have ${near.remaining <= 0 ? 0 : near.remaining} hours left for "${near.name}".`
          : lang === "tr"
          ? "Şimdilik yeni bir uyarı yok."
          : "No new alerts for now.";
      showToast(t.notifDemoTitle, body);
    }
  };

  // ---- export -------------------------------------------------------------
  const buildExports = (scope: "course" | "all"): CourseExport[] => {
    if (scope === "course" && selectedCourseId) {
      const c = [...activeVMs, ...Object.values(archivedCourses).flat()].find((x) => x.id === selectedCourseId);
      if (c) return [{ course: c, records: recordsByCourse[c.id] ?? [] }];
      return [];
    }
    return activeVMs.map((c) => ({ course: c, records: recordsByCourse[c.id] ?? [] }));
  };
  const doExportText = async () => {
    if (!exportSheet) return;
    const items = buildExports(exportSheet.scope);
    const text = buildTextSummary(items, lang, settings?.userName);
    const res = await shareText(text, `GMT — ${t.summaryTitle}`);
    setExportSheet(null);
    if (res === "copied") showToast(t.notifDemoTitle, lang === "tr" ? "Özet panoya kopyalandı." : "Summary copied to clipboard.");
    else if (res === "failed") showToast(t.notifDemoTitle, lang === "tr" ? "Paylaşım başarısız." : "Sharing failed.");
  };
  const doExportPdf = () => {
    if (!exportSheet) return;
    printSummary(buildExports(exportSheet.scope), lang, settings?.userName);
    setExportSheet(null);
  };

  // ---- derived ------------------------------------------------------------
  const visibleCourses = useMemo(() => {
    let list = [...activeVMs];
    const q = search.trim().toLocaleLowerCase(lang === "tr" ? "tr" : "en");
    if (q) list = list.filter((c) => c.name.toLocaleLowerCase(lang === "tr" ? "tr" : "en").includes(q));
    if (sortMode === "near") list.sort((a, b) => b.ratio - a.ratio);
    else if (sortMode === "name") list.sort((a, b) => a.name.localeCompare(b.name, lang));
    else list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }, [activeVMs, search, sortMode, lang]);

  const nearCount = activeVMs.filter((c) => c.warn).length;
  const selectedVM =
    selectedCourseId != null
      ? [...activeVMs, ...Object.values(archivedCourses).flat()].find((c) => c.id === selectedCourseId) ?? null
      : null;
  const selectedRecords = selectedCourseId ? recordsByCourse[selectedCourseId] ?? [] : [];
  const recordsByDate = useMemo(() => {
    const m: Record<string, AbsenceRecord> = {};
    for (const r of selectedRecords) m[r.date] = r;
    return m;
  }, [selectedRecords]);

  if (!ready || !settings) {
    return (
      <div className={`app-root thm-${theme}`}>
        <div className="app-shell" />
      </div>
    );
  }

  // ======================= RENDER ==========================================
  return (
    <div className={`app-root thm-${theme}`} data-theme={theme}>
      <div className={`app-shell thm-${theme}`}>
        {screen === "login" && renderLogin()}
        {screen === "guestName" && renderGuestName()}
        {screen === "home" && renderHome()}
        {screen === "detail" && renderDetail()}

        {toast && (
          <div className="notif-toast" role="status">
            <div className="notif-icon-mark" />
            <div className="notif-text">
              <div className="fw7 fs13">{toast.title}</div>
              <div className="fs12 sub">{toast.body}</div>
            </div>
          </div>
        )}

        {renderSheets()}
      </div>
    </div>
  );

  // ----------------------- screens -----------------------------------------
  function ThemeLangIcons({ small }: { small?: boolean }) {
    const cls = small ? "icon-btn small" : "icon-btn";
    return (
      <div className="icon-row">
        <button className={cls} onClick={toggleTheme} aria-label="theme">
          {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        </button>
        <button className={cls} onClick={toggleLang} aria-label="language">
          {lang === "tr" ? "EN" : "TR"}
        </button>
      </div>
    );
  }

  function renderLogin() {
    return (
      <div className="scr login-scr">
        <div className="login-hero">
          <div className="login-badge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/gmt-logo-full.png" className="logo-mark-badge" alt="GMT" />
          </div>
          <div className="login-title">{t.loginTitle}</div>
          <div className="login-sub">{t.loginSubtitle}</div>
        </div>
        <div className="login-card">
          <div className="row between">
            <div />
            <ThemeLangIcons small />
          </div>
          <div className="fs20 fw8 tc">{t.welcomeTitle}</div>
          <div className="fs13 sub tc">{t.welcomeDesc}</div>
          <button className="btn-google-outline" onClick={loginGoogle}>
            <GoogleIcon />
            {t.googleLogin}
          </button>
          {authError && (
            <div className="info-box" style={{ borderColor: "var(--danger)" }}>
              <span className="info-icon" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>!</span>
              <span>{authError}</span>
            </div>
          )}
          <div className="divider">{t.or}</div>
          <button className="btn-guest-soft" onClick={loginGuest}>
            <PersonIcon />
            {t.guestLogin}
          </button>
          <div className="info-box">
            <span className="info-icon">i</span>
            <span>{t.guestInfo}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderGuestName() {
    return (
      <div className="scr">
        <div className="login-top" style={{ padding: 0 }}>
          <button className="icon-btn small" onClick={() => setScreen("login")}>‹</button>
          <div className="spacer" />
        </div>
        <div className="fs22 fw8 mb12">{t.guestNamePrompt}</div>
        <input
          className="input"
          placeholder={t.guestNamePlaceholder}
          value={guestNameInput}
          onChange={(e) => setGuestNameInput(e.target.value)}
          autoFocus
        />
        <button className="btn-primary" onClick={confirmGuest} disabled={!guestNameInput.trim()}>
          {t.continueBtn}
        </button>
      </div>
    );
  }

  function SyncPill() {
    const map: Record<SyncState, { cls: string; label: string }> = {
      synced: { cls: "synced", label: t.syncSynced },
      pending: { cls: "pending", label: t.syncPending },
      syncing: { cls: "syncing", label: t.syncSyncing },
      offline: { cls: "offline", label: t.syncOffline },
    };
    const it = map[syncState];
    return (
      <span className="sync-pill">
        <span className={`sync-dot ${it.cls}`} />
        {it.label}
      </span>
    );
  }

  function renderHome() {
    const showSearch = activeVMs.length > 3;
    return (
      <div className="scr">
        <div className="top-row">
          <div>
            <div className="fs22 fw8">{t.myCourses}</div>
            <div className="fs13 sub">{t.welcome(settings!.userName ?? "")}</div>
          </div>
          <div className="icon-row">
            <button className="icon-btn" onClick={toggleTheme} aria-label="theme">
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
            <button className="icon-btn" onClick={toggleLang} aria-label="language">
              {lang === "tr" ? "EN" : "TR"}
            </button>
            <button className="icon-btn" onClick={onBell} aria-label="notifications">🔔</button>
          </div>
        </div>

        {/* status row */}
        {settings!.isGuest ? (
          <div className="guest-banner">
            <span>{t.guestBanner}</span>
            <button className="link-btn" onClick={goCreateAccount}>{t.createAccount}</button>
          </div>
        ) : (
          <div className="row between">
            <SyncPill />
          </div>
        )}

        {/* segment tabs */}
        <div className="seg">
          <button className={homeTab === "active" ? "active" : ""} onClick={() => setHomeTab("active")}>
            {t.active}
          </button>
          <button className={homeTab === "past" ? "active" : ""} onClick={() => setHomeTab("past")}>
            {t.past}
          </button>
        </div>

        {homeTab === "active" ? renderActiveTab(showSearch) : renderPastTab()}
      </div>
    );
  }

  function renderActiveTab(showSearch: boolean) {
    if (activeVMs.length === 0) {
      return (
        <>
          <div className="empty-state">
            <div className="empty-icon">＋</div>
            <div className="fw7 fs16">{t.emptyTitle}</div>
            <div className="fs13 sub">{t.emptyDesc}</div>
            <button className="btn-primary" onClick={openAddCourse}>{t.addCourseBtn}</button>
          </div>
        </>
      );
    }
    return (
      <>
        {nearCount > 0 && (
          <div className="summary-card">
            <span className="summary-dot" />
            <span>{t.summaryNear(nearCount)}</span>
          </div>
        )}

        {showSearch && (
          <div className="search-row">
            <input
              className="search-input"
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="sort-select" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="default">{t.sortDefault}</option>
              <option value="near">{t.sortNearLimit}</option>
              <option value="name">{t.sortName}</option>
            </select>
          </div>
        )}

        {jiggle && (
          <div className="jiggle-hint">
            <button className="link-btn" onClick={() => setJiggle(false)}>{t.doneEditing}</button>
          </div>
        )}

        <div className="course-list">
          {visibleCourses.map((c) => (
            <CourseCard
              key={c.id}
              c={c}
              onClick={() => (jiggle ? setJiggle(false) : openCourse(c.id))}
              onLongPress={() => setJiggle(true)}
              onDelete={() => setPendingDeleteId(c.id)}
              jiggle={jiggle}
              dark={theme === "dark"}
              t={t}
            />
          ))}
        </div>

        <div className="stack mt8" style={{ marginBottom: 76 }}>
          <button className="btn-ghost" onClick={() => setExportSheet({ scope: "all" })}>
            <ShareIcon /> {t.exportShare}
          </button>
          <button className="btn-ghost" onClick={() => setSemesterSheet(true)}>{t.newSemester}</button>
          <button className="btn-reset" onClick={() => setResetConfirm(true)}>{t.resetProfile}</button>
        </div>

        <button className="fab" onClick={openAddCourse} aria-label="add">＋</button>
      </>
    );
  }

  function renderPastTab() {
    if (archivedSemesters.length === 0) {
      return <div className="fs13 sub" style={{ marginTop: 8 }}>{t.noPastSemesters}</div>;
    }
    return (
      <div className="stack">
        {archivedSemesters.map((sem) => {
          const cs = archivedCourses[sem.id] ?? [];
          const open = expandedSem === sem.id;
          return (
            <div key={sem.id} className="stack">
              <button
                className="summary-card"
                style={{ justifyContent: "space-between", width: "100%" }}
                onClick={() => setExpandedSem(open ? null : sem.id)}
              >
                <span>{sem.name}</span>
                <span className="sub fs12">{cs.length} {lang === "tr" ? "ders" : "courses"} {open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div className="course-list">
                  {cs.map((c) => (
                    <CourseCard key={c.id} c={c} archived onClick={() => openCourse(c.id)} dark={theme === "dark"} t={t} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderDetail() {
    if (!selectedVM) return null;
    const c = selectedVM;
    const remainLabel = c.remaining <= 0 ? t.noneLeft : `${c.remaining} ${t.saUnit}`;
    return (
      <div className="scr">
        <div className="top-row">
          <button className="icon-btn small" onClick={closeDetail}>‹</button>
          <div className="fw8 fs16" style={{ flex: 1, textAlign: "center" }}>{c.name}</div>
          <div className="icon-row">
            {!c.archived && (
              <button className="icon-btn small" onClick={() => openEditCourse(c)} aria-label="edit">✎</button>
            )}
            <button className="icon-btn small" onClick={() => setExportSheet({ scope: "course" })} aria-label="share">
              <ShareIcon />
            </button>
            <button className="icon-btn small" onClick={() => setClearRecordsConfirm(true)} aria-label="clear">
              <TrashIcon />
            </button>
          </div>
        </div>

        <div className="stat-row">
          <div className="stat-box">
            <div className="fs22 fw8" style={{ color: ratioColor(c.ratio, theme === "dark") }}>{remainLabel}</div>
            <div className="fs11 sub upper">{t.remaining}</div>
          </div>
          <div className="stat-box">
            <div className="fs22 fw8">{c.used} {t.saUnit}</div>
            <div className="fs11 sub upper">{t.used}</div>
          </div>
        </div>

        {!c.archived && <div className="fs12 sub tc">{t.markHint}</div>}

        <Calendar
          year={calYear}
          month={calMonth}
          lang={lang}
          recordsByDate={recordsByDate}
          onPrev={prevMonth}
          onNext={nextMonth}
          onTapDay={c.archived ? () => {} : openDay}
        />

        <div className="fs12 fw7 sub upper">{t.records}</div>
        {selectedRecords.length ? (
          <div className="records-list">
            {selectedRecords.map((r) => (
              <div key={r.id} className="record-row" onClick={() => !c.archived && openDay(r.date, r)}>
                <span className="rec-date">
                  {new Date(r.date + "T00:00:00").getDate()} {MONTHS[lang][new Date(r.date + "T00:00:00").getMonth()]}{" "}
                  {new Date(r.date + "T00:00:00").getFullYear()}
                </span>
                <span className="hour-chip">{r.hours} {t.saUnit}</span>
                {!c.archived && (
                  <button
                    className="del-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteRecordDirect(r.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="fs13 sub">{t.noRecords}</div>
        )}
      </div>
    );
  }

  // ----------------------- sheets ------------------------------------------
  function renderSheets() {
    return (
      <>
        {courseSheet && (
          <>
            <div className="scrim" onClick={() => setCourseSheet(null)} />
            <div className="sheet">
              <div className="sheet-handle" />
              <div className="fw8 fs18">{courseSheet.editId ? t.editCourseTitle : t.newCourseTitle}</div>
              <input
                className="input"
                placeholder={t.courseNamePlaceholder}
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                autoFocus
              />
              <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder={t.totalHoursPlaceholder}
                value={courseHours}
                onChange={(e) => setCourseHours(e.target.value)}
              />
              <div className="sheet-actions">
                <button className="btn-secondary" onClick={() => setCourseSheet(null)}>{t.cancel}</button>
                <button className="btn-primary" onClick={saveCourse} disabled={!canSaveCourse}>{t.save}</button>
              </div>
              {courseSheet.editId && (
                <button
                  className="btn-reset"
                  onClick={() => setPendingDeleteId(courseSheet.editId)}
                >
                  <TrashIcon /> {t.deleteCourse}
                </button>
              )}
            </div>
          </>
        )}

        {dayPopover && renderDaySheet()}

        {resetConfirm && (
          <ConfirmSheet
            title={t.resetTitle}
            desc={t.resetDesc}
            cancel={t.cancel}
            confirm={t.resetConfirmBtn}
            onCancel={() => setResetConfirm(false)}
            onConfirm={doReset}
          />
        )}
        {clearRecordsConfirm && (
          <ConfirmSheet
            title={t.clearRecordsTitle}
            desc={t.clearRecordsDesc}
            cancel={t.no}
            confirm={t.yes}
            onCancel={() => setClearRecordsConfirm(false)}
            onConfirm={doClearRecords}
          />
        )}
        {pendingDeleteId && (
          <ConfirmSheet
            title={t.deleteCourseTitle}
            desc={t.deleteCourseConfirm}
            cancel={t.no}
            confirm={t.yes}
            onCancel={() => setPendingDeleteId(null)}
            onConfirm={doDeleteCourse}
          />
        )}

        {semesterSheet && (
          <>
            <div className="scrim" onClick={() => setSemesterSheet(false)} />
            <div className="sheet">
              <div className="sheet-handle" />
              <div className="fw8 fs18">{t.newSemester}</div>
              <div className="fs13 sub">{t.newSemesterDesc}</div>
              <input
                className="input"
                placeholder={t.newSemesterName}
                value={semesterName}
                onChange={(e) => setSemesterName(e.target.value)}
              />
              <div className="sheet-actions">
                <button className="btn-secondary" onClick={() => setSemesterSheet(false)}>{t.cancel}</button>
                <button className="btn-primary" onClick={startSemester}>{t.startSemester}</button>
              </div>
            </div>
          </>
        )}

        {exportSheet && (
          <>
            <div className="scrim" onClick={() => setExportSheet(null)} />
            <div className="sheet">
              <div className="sheet-handle" />
              <div className="fw8 fs18">{t.exportShare}</div>
              <button className="btn-ghost" onClick={doExportText}><ShareIcon /> {t.exportText}</button>
              <button className="btn-ghost" onClick={doExportPdf}>{t.exportPdf}</button>
              <button className="btn-secondary" onClick={() => setExportSheet(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </>
    );
  }

  function renderDaySheet() {
    if (!dayPopover) return null;
    const d = new Date(dayPopover.date + "T00:00:00");
    const dateLabel = `${d.getDate()} ${MONTHS[lang][d.getMonth()]} ${d.getFullYear()}`;
    const maxH = Math.max(8, selectedVM?.totalHours ?? 8);
    const setHours = (h: number) => setDayPopover((p) => (p ? { ...p, hours: Math.max(1, Math.min(maxH, h)) } : p));
    return (
      <>
        <div className="scrim" onClick={() => setDayPopover(null)} />
        <div className="sheet">
          <div className="sheet-handle" />
          <div className="fw8 fs16">{dateLabel}</div>
          <div className="field-label">{t.hoursLabel}</div>
          <div className="stepper">
            <button onClick={() => setHours(dayPopover.hours - 1)}>−</button>
            <div className="hours-val">{dayPopover.hours} {t.saUnit}</div>
            <button onClick={() => setHours(dayPopover.hours + 1)}>＋</button>
          </div>
          <input
            className="range-input"
            type="range"
            min={1}
            max={maxH}
            step={1}
            value={dayPopover.hours}
            onChange={(e) => setHours(parseInt(e.target.value, 10))}
          />
          <div className="sheet-actions">
            {dayPopover.recordId ? (
              <button className="btn-secondary" onClick={deleteDay}>{t.delete}</button>
            ) : (
              <button className="btn-secondary" onClick={() => setDayPopover(null)}>{t.cancel}</button>
            )}
            <button className="btn-primary" onClick={saveDay} disabled={!(dayPopover.hours > 0)}>{t.save}</button>
          </div>
        </div>
      </>
    );
  }
}

// ---- small presentational components --------------------------------------
function CourseCard({
  c,
  onClick,
  onLongPress,
  onDelete,
  jiggle,
  archived,
  dark,
  t,
}: {
  c: CourseVM;
  onClick: () => void;
  onLongPress?: () => void;
  onDelete?: () => void;
  jiggle?: boolean;
  archived?: boolean;
  dark: boolean;
  t: ReturnType<typeof tf>;
}) {
  const pct = Math.min(100, Math.round(c.ratio * 100));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // True once a long-press fired, so the trailing click doesn't also open the
  // course detail.
  const longFired = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (archived || !onLongPress) return;
    // Ignore the × badge's own pointer.
    if ((e.target as HTMLElement).closest(".cc-del")) return;
    longFired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timer.current = setTimeout(() => {
      longFired.current = true;
      // Haptic feedback where supported (Android/Chrome). iOS ignores it.
      try {
        navigator.vibrate?.(15);
      } catch {
        /* ignore */
      }
      onLongPress();
    }, 450);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = Math.abs(e.clientX - start.current.x);
    const dy = Math.abs(e.clientY - start.current.y);
    // A scroll/drag cancels the pending long-press.
    if (dx > 10 || dy > 10) clearTimer();
  };
  const endPress = () => {
    clearTimer();
    start.current = null;
  };
  const handleClick = () => {
    if (longFired.current) {
      // Consume the click that follows a long-press.
      longFired.current = false;
      return;
    }
    onClick();
  };

  return (
    <div
      className={`course-card${archived ? " archived" : ""}${jiggle ? " jiggling" : ""}`}
      onClick={handleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => {
        // Suppress the long-press context menu on mobile while in this mode.
        if (onLongPress) e.preventDefault();
      }}
    >
      {jiggle && !archived && (
        <button
          className="cc-del"
          aria-label={t.deleteCourse}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
        >
          ×
        </button>
      )}
      <div className="cc-top">
        <span className="fw7 fs16">{c.name}</span>
        {c.warn && <span className={`warn-badge ${c.warnClass}`}>!</span>}
      </div>
      <div className="cc-bar-track">
        <div className="cc-bar-fill" style={{ width: pct + "%", background: ratioColor(c.ratio, dark) }} />
      </div>
      <div className="cc-bottom fs13">
        <span className="sub">
          {t.used} <span className="fw7 cc-val">{c.used} {t.saUnit}</span>
        </span>
        {c.remaining <= 0 ? (
          <span className="fw7 cc-none">{t.noneLeft}</span>
        ) : (
          <span className="sub">
            {t.remaining} <span className="fw7 cc-val" style={{ color: ratioColor(c.ratio, dark) }}>{c.remaining} {t.saUnit}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function ConfirmSheet({
  title,
  desc,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  desc: string;
  cancel: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="fw8 fs18">{title}</div>
        <div className="fs13 sub">{desc}</div>
        <div className="sheet-actions">
          <button className="btn-secondary" onClick={onCancel}>{cancel}</button>
          <button className="btn-danger" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </>
  );
}
