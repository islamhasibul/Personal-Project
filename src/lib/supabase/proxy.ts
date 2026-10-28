import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase client for the proxy (formerly "middleware") layer.
 *
 * This is deliberately separate from `src/lib/supabase/server.ts`. The proxy
 * runs before the React tree is rendered, so it does not have access to the
 * request context that `next/headers` reads from. Instead it works directly
 * with `request.cookies` and writes the refreshed cookies onto the response
 * it is about to return.
 *
 * The cookie write MUST happen on the response that is returned to the
 * browser. A refreshed access token that is never written back is a token
 * that is lost, and the user is silently signed out on the next request.
 */
export function createProxyClient(request: NextRequest, response: NextResponse) {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
}
