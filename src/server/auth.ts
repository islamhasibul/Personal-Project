import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, as verified by Supabase Auth.
 *
 * `getUser()` re-validates the access token with the Auth server. It is
 * deliberately not `getSession()`, which only reads the cookie and does not
 * check that the token is still valid — a forged cookie would pass that.
 */
export type AuthUser = {
  id: string;
  email: string | null;
};

/**
 * Returns the signed-in user, or redirects to the login page.
 *
 * Every server action and every protected page calls this first, so an
 * unauthenticated request never reaches a query. Authorization beyond "is
 * there a session" is enforced by RLS, not by this function: the client
 * returned here is the user-scoped client, so a query for someone else's
 * row comes back empty and a write to it is rejected by the database.
 */
export async function requireUser(returnTo?: string): Promise<AuthUser> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${next}`);
  }

  return { id: user.id, email: user.email ?? null };
}
