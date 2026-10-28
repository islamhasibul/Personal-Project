import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * Browser-side Supabase client.
 *
 * Used by client components that talk to Supabase directly. The session is
 * persisted in cookies by the server client, and `@supabase/ssr` keeps the two
 * in sync, so a client component sees the same session as the server.
 */
export function createClient() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }
  return createBrowserClient(config.url, config.anonKey);
}
