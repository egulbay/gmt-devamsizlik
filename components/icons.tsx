import * as React from "react";

export function SunIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" fill="#FDB813" stroke="#FDB813" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg className="ico-thm" viewBox="0 0 24 24">
      <path d="M20 14.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 10.5z" fill="#C7CBD4" stroke="#AEB3BD" strokeWidth={1} />
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
