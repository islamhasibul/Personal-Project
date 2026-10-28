import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Every query issued through this client runs as the signed-in user, so the
 * RLS policies in `supabase/migrations/003_rls.sql` are what actually decide
 * which rows the request can read or write. There is no service-role client
 * in this project, by design.
 *
 * A fresh client is created per call: the client holds per-request state
 * (the session, and the pending cookie writes a token refresh produces), so
 * sharing one across requests would leak state between users.
 */
export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          // A Server Component renders read-only: Next.js throws
          // "Cookies can only be modified in a Server Action or Route
          // Handler". `setAll` is only called when a token refresh happens,
          // and `src/proxy.ts` refreshes the session on every request, so
          // the refreshed token is written there instead.
          //
          // Only that specific error is swallowed. Anything else is a real
          // failure -- swallowing it would hide, for example, a failed
          // sign-out that never actually cleared the session cookie.
          if (!isReadonlyCookiesError(error)) {
            throw error;
          }
        }
      },
    },
  });
}

/**
 * Whether the error is Next.js refusing a cookie write from a read-only
 * context.
 *
 * The error class is not exported, so it is matched on the message. The
 * check is deliberately narrow: an unrelated failure is re-thrown.
 */
function isReadonlyCookiesError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "Cookies can only be modified in a Server Action or Route Handler",
    )
  );
}
