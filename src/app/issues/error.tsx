"use client";

import { RouteError } from "@/components/route-error";

export default function IssuesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      title="Could not load your issues"
      message={
        error.message ||
        "Something went wrong while loading the issues list. Please try again."
      }
      onRetry={reset}
    />
  );
}
