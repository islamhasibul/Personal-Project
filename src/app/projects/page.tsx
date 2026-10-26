import { AppShell } from "@/components/app-shell";

/**
 * Projects route placeholder. Project CRUD (create, rename, delete) arrives
 * in Phase 4 once the projects table and its RLS policies exist.
 */
export default function ProjectsPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Projects
      </h1>
      <p className="mt-2 text-sm text-muted">
        Project management is not wired up yet.
      </p>
    </AppShell>
  );
}
