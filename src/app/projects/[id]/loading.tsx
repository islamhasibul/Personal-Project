import { Card } from "@/components/ui";

/**
 * A single project, while it is loading.
 */
export default function ProjectLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-7 w-56 animate-pulse rounded bg-muted/30" />
        <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted/20" />
      </div>

      <Card>
        <ul className="divide-y divide-border">
          <li className="px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-muted/20" />
          </li>
        </ul>
      </Card>

      <Card className="p-4">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/30" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-muted/20" />
      </Card>

      <span className="sr-only">Loading project...</span>
    </div>
  );
}
