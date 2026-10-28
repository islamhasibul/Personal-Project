import { Card } from "@/components/ui";

/**
 * The projects list, while it is loading.
 *
 * Next.js shows this automatically while the server component for the route
 * is still running. The shape mirrors the real page so the layout does not
 * jump when the data arrives.
 */
export default function ProjectsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-7 w-40 animate-pulse rounded bg-muted/30" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted/20" />
      </div>

      <Card className="p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-muted/30" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-muted/20" />
      </Card>

      <Card>
        <ul className="divide-y divide-border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="px-4 py-3">
              <div className="h-4 w-48 animate-pulse rounded bg-muted/20" />
            </li>
          ))}
        </ul>
      </Card>

      <span className="sr-only">Loading projects...</span>
    </div>
  );
}
