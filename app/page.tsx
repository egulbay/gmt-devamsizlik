"use client";

// build: supabase env wiring (forces a fresh, cache-free Vercel build)
import dynamic from "next/dynamic";

// The whole app is client-only (IndexedDB / offline-first), so disable SSR.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Page() {
  return <App />;
}
