"use client";

import { useState } from "react";
import { PersonIcon } from "@/components/icons";

// Profil fotoğrafı Google'ın sunucusundan geliyor: çevrimdışıyken ya da
// bağlantı kopukken yüklenemez — o durumda kişi simgesine döner.
export default function Avatar({ url, size }: { url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span className="set-ic" style={size ? { width: size, height: size } : undefined}>
        <PersonIcon />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="set-avatar"
      style={size ? { width: size, height: size } : undefined}
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
