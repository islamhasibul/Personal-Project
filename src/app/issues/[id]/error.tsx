"use client";

import { RouteError } from "@/components/route-error";

export default function IssueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      title="Could not load this issue"
      message={
        error.message ||
        "Something went wrong while loading the issue. Please try again."
      }
      onRetry={reset}
    />
  );
}
