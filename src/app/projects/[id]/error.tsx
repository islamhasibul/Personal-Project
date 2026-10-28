"use client";

import { RouteError } from "@/components/route-error";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      title="Could not load this project"
      message={
        error.message ||
        "Something went wrong while loading the project. Please try again."
      }
      onRetry={reset}
    />
  );
}
