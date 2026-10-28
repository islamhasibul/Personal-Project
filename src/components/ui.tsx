/**
 * Small presentational primitives shared by the CRUD screens.
 *
 * These are plain server-renderable components: no "use client", no state.
 * Interactive behaviour lives in the client components that use them.
 */

/** The card surface used for every panel in the app. */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-background ${className}`}
    >
      {children}
    </div>
  );
}

/** A page-level heading with an optional description and actions slot. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The empty state shown when a list has no rows.
 *
 * `action` lets the empty state offer the way out of it, so a user who has
 * deleted their last project is told how to create another one.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** An inline error banner. */
export function ErrorBanner({
  title = "Something went wrong",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-0.5">{message}</p>
    </div>
  );
}

/** A success banner. */
export function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
    >
      {message}
    </div>
  );
}

/** The primary button style, shared by links and submit buttons. */
export const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

/** The secondary button style. */
export const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60";

/** The destructive button style, for delete actions. */
export const DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";

/** The text input style. */
export const INPUT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground disabled:opacity-60";

/** The select style. */
export const SELECT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground disabled:opacity-60";
