"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  loginAction,
  signupAction,
  type AuthActionResult,
} from "@/server/auth-actions";

/**
 * The email + password form shared by /login and /signup.
 *
 * `useActionState` keeps the submission state (pending, error, success) in
 * React rather than in the URL, so the form does not do a full navigation
 * and the messages are announced to assistive technology.
 */
export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "signup";
  next?: string;
}) {
  const action = mode === "login" ? loginAction : signupAction;
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(action, undefined);

  const isSignup = mode === "signup";
  const fieldErrors = state?.fieldErrors;
  const needsConfirmation = state?.needsConfirmation;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {isSignup ? "Create your account" : "Sign in to DevDesk"}
        </h1>
        <p className="text-sm text-muted">
          {isSignup
            ? "A clean issue tracker for individual developers."
            : "Welcome back. Enter your details to continue."}
        </p>
      </div>

      {needsConfirmation ? (
        <div
          role="status"
          className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground"
        >
          <p className="font-medium">Check your email to confirm your account.</p>
          <p className="mt-1 text-muted">
            We sent a confirmation link to your inbox. Click it, then sign in.
          </p>
        </div>
      ) : null}

      {state?.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            defaultValue=""
            aria-invalid={fieldErrors?.email ? true : undefined}
            aria-describedby={fieldErrors?.email ? "email-error" : undefined}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground disabled:opacity-60"
          />
          {fieldErrors?.email ? (
            <span id="email-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.email}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Password</span>
          <input
            type="password"
            name="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={6}
            aria-invalid={fieldErrors?.password ? true : undefined}
            aria-describedby={fieldErrors?.password ? "password-error" : undefined}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground disabled:opacity-60"
          />
          {fieldErrors?.password ? (
            <span id="password-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.password}
            </span>
          ) : null}
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? isSignup
              ? "Creating account..."
              : "Signing in..."
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="text-sm text-muted">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-foreground underline underline-offset-4"
        >
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
