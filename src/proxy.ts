import { NextResponse, type NextRequest } from "next/server";

import { createProxyClient } from "@/lib/supabase/proxy";

/**
 * Session refresh and route protection.
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`. The file
 * name and the exported function name are what Next looks for, so this file
 * is `src/proxy.ts` and exports `proxy`.
 *
 * Two jobs:
 *
 *   1. Refresh the session. Supabase access tokens are short-lived. Calling
 *      `getUser()` here makes the client verify the token and, when it is
 *      close to expiry, write a fresh one back through the `setAll` cookie
 *      handler onto the response we return. Without this, a signed-in user
 *      is silently signed out after the token expires.
 *
 *   2. Redirect signed-out users away from the protected routes. The
 *      authoritative check is still `requireUser()` in the server layer --
 *      this is a convenience redirect, not the security boundary. RLS is.
 */

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = ["/projects", "/issues", "/dashboard"];

/** Routes a signed-in user should be moved away from. */
const AUTH_ROUTES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Nothing to do when Supabase is not configured yet. The pages themselves
  // render a "not configured" notice, so the app stays navigable.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  const supabase = createProxyClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so the user lands where they were going.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    // Carry over any refreshed cookies onto the redirect response, so the
    // redirect does not discard a token refresh that just happened.
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and image files, so a
     * session refresh is never skipped for a page the user actually visits.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
