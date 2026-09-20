import * as React from "react";

export function SunIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="12" r="4.3" fill="currentColor" fillOpacity="0.16" />
      <path d="M12 3v2.4M12 18.6V21M4.2 12H1.8M22.2 12h-2.4M6.3 6.3 4.6 4.6M19.4 19.4l-1.7-1.7M17.7 6.3l1.7-1.7M4.6 19.4l1.7-1.7" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none">
      <path d="M20.5 14.8A8.5 8.5 0 1 1 9.7 3.6a7 7 0 0 0 10.8 11.2Z" fill="currentColor" />
    </svg>
  );
}

export function GlobeIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.3" />
      <path d="M3.7 12h16.6M12 3.7c2.5 2.3 3.9 5.2 3.9 8.3s-1.4 6-3.9 8.3c-2.5-2.3-3.9-5.2-3.9-8.3s1.4-6 3.9-8.3Z" />
    </svg>
  );
}

export function ProjectsIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3.3" width="14" height="17.4" rx="2.6" />
      <path d="M8.5 8.7h7M8.5 12.4h7M8.5 16.1h4.4" />
    </svg>
  );
}

// ＋ karakteri yazı tipine göre kutunun içinde hafif kaymış çiziliyor (glifin
// kendi boşlukları yüzünden); çizili ikon ise viewBox'ın tam ortasında durur.
export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 5.2A2.2 2.2 0 0 1 6.7 3h12.8v15.4H6.7a2.2 2.2 0 0 0-2.2 2.2V5.2Z" />
      <path d="M4.5 20.6A2.2 2.2 0 0 0 6.7 22.8h12.8v-4.4M8.5 7.8h7" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.6.84 1 1.5 1.03H21a2 2 0 1 1 0 4h-.09c-.66.03-1.24.43-1.5 1.03Z" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9.5a6 6 0 0 1 12 0c0 5.2 2 6.8 2 6.8H4s2-1.6 2-6.8Z" />
      <path d="M10.2 19.6a2 2 0 0 0 3.6 0" />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="M3.9 17.2l4.5-4.2a2 2 0 0 1 2.7 0l3 2.8m0 0 1.7-1.6a2 2 0 0 1 2.7 0l1.6 1.5m-6-.1 2.3 2.2" />
    </svg>
  );
}

export function SheetIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.6" y="4" width="16.8" height="16" rx="2.4" />
      <path d="M3.6 9.2h16.8M9.4 9.2V20M3.6 14.6h16.8" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.8" y="5" width="16.4" height="15.2" rx="2.6" />
      <path d="M3.8 9.6h16.4M8.2 3.2v3.4M15.8 3.2v3.4" />
      <path d="M8 13.3h.01M12 13.3h.01M16 13.3h.01M8 16.6h.01M12 16.6h.01" strokeWidth={2.4} />
    </svg>
  );
}

export function GoogleIcon() {
  return (
    <span className="g-badge">
      <svg viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.4 0 6.4 1.2 8.8 3.5l6.5-6.5C35.1 2.6 29.9.5 24 .5 14.6.5 6.5 5.9 2.6 13.9l7.6 5.9C12.1 13.7 17.6 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.8-9.9 6.8-17.4z" />
        <path fill="#FBBC05" d="M10.2 19.8a14.5 14.5 0 0 0 0 8.4l-7.6 5.9a24 24 0 0 1 0-20.2l7.6 5.9z" />
        <path fill="#34A853" d="M24 47.5c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.9 2.3-8.5 2.3-6.4 0-11.9-4.2-13.8-9.9l-7.6 5.9C6.5 42.1 14.6 47.5 24 47.5z" />
      </svg>
    </span>
  );
}

export function PersonIcon() {
  return (
    <svg className="person-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c0-4.4 3.4-6.6 7.5-6.6s7.5 2.2 7.5 6.6" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="ico-trash" viewBox="0 0 24 24" fill="none" stroke="#D8433B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5l5.5 5.5L20 6.5" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.7" r="0.25" fill="currentColor" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
