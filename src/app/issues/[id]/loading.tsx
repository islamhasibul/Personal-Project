import { Card } from "@/components/ui";

/**
 * A single issue, while it is loading.
 */
export default function IssueLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-7 w-64 animate-pulse rounded bg-muted/30" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted/20" />
      </div>

      <Card className="p-4">
        <div className="flex gap-3">
          <div className="h-6 w-16 animate-pulse rounded bg-muted/20" />
          <div className="h-6 w-16 animate-pulse rounded bg-muted/20" />
        </div>
        <div className="mt-4 h-16 w-full animate-pulse rounded bg-muted/20" />
      </Card>

      <Card className="p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-muted/30" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-muted/20" />
      </Card>

      <span className="sr-only">Loading issue...</span>
    </div>
  );
}
