"use client";

import { useFormStatus } from "react-dom";

import { logoutAction } from "@/server/auth-actions";

/**
 * The submit button for the logout form.
 *
 * `useFormStatus` must be called from a component that is rendered *inside*
 * the form, so it lives in its own component rather than in the form itself.
 */
function LogoutSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-border px-3 py-1.5 text-muted transition hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Logging out..." : "Log out"}
    </button>
  );
}

/**
 * Logout control.
 *
 * A real `<form>` posting to a server action, so signing out works with
 * JavaScript disabled and needs no client-side session handling.
 */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <LogoutSubmit />
    </form>
  );
}
