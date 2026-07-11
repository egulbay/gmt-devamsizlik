import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

export function isCloudEnabled(): boolean {
  return Boolean(url && anon);
}

// Returns a Supabase client, or null when the project isn't configured.
// Auth session is persisted by supabase-js in IndexedDB (we pass a custom
// storage) so we never touch localStorage for our own data.
export function supabase(): SupabaseClient | null {
  if (!isCloudEnabled()) return null;
  if (_client) return _client;
  _client = createClient(url as string, anon as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}
