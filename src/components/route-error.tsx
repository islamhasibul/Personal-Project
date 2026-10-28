"use client";

import { ErrorBanner } from "@/components/ui";

/**
 * The error state for a route.
 *
 * Next.js renders this when a server component throws -- for example when
 * the database is unreachable or a query fails. It offers a retry, because
 * most of these failures are transient.
 */
export function RouteError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner title={title} message={message} />
      <div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
