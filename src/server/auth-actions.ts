"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveRedirectTarget } from "@/server/redirect";

/**
 * Result of an auth form submission.
 *
 * `error` is a message that is safe to show to the user. `fieldErrors` maps
 * a form field to its own message so the form can highlight the offending
 * input rather than showing one generic banner.
 */
export type AuthActionState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
  /** Set when signup succeeded but the account still needs email confirmation. */
  needsConfirmation?: boolean;
};

export type AuthActionResult = AuthActionState | undefined;

/**
 * A short, safe-to-display message for a Supabase auth error.
 *
 * Supabase's raw messages are user-facing already, but they can be verbose
 * and occasionally leak internals. This keeps the known, actionable ones and
 * falls back to a generic message for anything unrecognised.
 */
function readableAuthError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "That email and password combination is not correct.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }
  if (lower.includes("user already registered")) {
    return "An account with that email already exists. Try signing in instead.";
  }
  if (lower.includes("password should be at least")) {
    return "Password must be at least 6 characters long.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("unable to validate email")) {
    return "That email address is not valid.";
  }
  return message;
}

/**
 * Validates the shared email + password shape before hitting Supabase, so
 * obvious mistakes produce an immediate, specific message.
 */
function validateCredentials(email: string, password: string): AuthActionState | null {
  const fieldErrors: NonNullable<AuthActionState["fieldErrors"]> = {};

  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    fieldErrors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Password is required.";
  } else if (password.length < 6) {
    fieldErrors.password = "Password must be at least 6 characters long.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }
  return null;
}

/**
 * Signs a user up.
 *
 * The signup trigger in `supabase/migrations/002_triggers.sql` creates the
 * profile row and the default "Inbox" project when the `auth.users` row is
 * inserted. That is a database-side effect: this function only has to
 * create the auth user.
 *
 * Note that this Supabase project has email confirmation switched ON, so
 * `signUp` returns a user with no session. The form shows a "check your
 * email" state rather than pretending the user is signed in.
 */
export async function signupAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const invalid = validateCredentials(email, password);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });

  if (error) {
    return { error: readableAuthError(error.message, "Could not create your account.") };
  }

  // No session means the account still needs to be confirmed by email.
  // `session` is null when email confirmation is required.
  if (!data.session) {
    return { needsConfirmation: true };
  }

  redirect("/projects");
}

/**
 * Signs a user in.
 *
 * On success the session is written to cookies by the Supabase SSR client.
 * The redirect happens after the action returns, so the cookie is on the
 * request that follows it.
 */
export async function loginAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const invalid = validateCredentials(email, password);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return { error: readableAuthError(error.message, "Could not sign you in.") };
  }

  const next = String(formData.get("next") ?? "");
  // Only allow same-origin relative paths, so `next` cannot be used as an
  // open redirect to another site.
  const destination = resolveRedirectTarget(next, "/projects");
  redirect(destination);
}

/**
 * Signs the user out and sends them back to the login page.
 *
 * `signOut` clears the auth cookies through the SSR client's `setAll`
 * handler. This runs in a Server Action, which is one of the two places
 * where writing cookies is allowed.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
