import { Card } from "@/components/ui";

/**
 * The issues list, while it is loading.
 */
export default function IssuesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-7 w-32 animate-pulse rounded bg-muted/30" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted/20" />
      </div>

      <Card className="p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-muted/30" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-muted/20" />
      </Card>

      <Card>
        <div className="border-b border-border px-4 py-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted/20" />
        </div>
        <ul className="divide-y divide-border">
          {[0, 1, 2, 3].map((row) => (
            <li key={row} className="px-4 py-3">
              <div className="h-4 w-56 animate-pulse rounded bg-muted/20" />
            </li>
          ))}
        </ul>
      </Card>

      <span className="sr-only">Loading issues...</span>
    </div>
  );
}
