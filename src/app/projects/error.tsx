"use client";

import { RouteError } from "@/components/route-error";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      title="Could not load your projects"
      message={
        error.message ||
        "Something went wrong while loading the projects list. Please try again."
      }
      onRetry={reset}
    />
  );
}
