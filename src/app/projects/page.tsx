import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { ProjectCreateForm } from "@/components/project-create-form";
import { ProjectRow } from "@/components/project-row";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/server/auth";
import { listProjects } from "@/server/projects";

export const metadata: Metadata = {
  title: "Projects · DevDesk",
};

/**
 * Projects list.
 *
 * The signed-in user's projects, with a create form and per-project rename
 * and delete actions. A user with no projects gets an empty state pointing
 * at the create form rather than a blank screen.
 */
export default async function ProjectsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Projects" />
        <Card className="mt-6 p-4 text-sm text-muted">
          Supabase is not configured. Set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          in <code className="font-mono text-xs">.env.local</code> to enable
          projects.
        </Card>
      </AppShell>
    );
  }

  const user = await requireUser("/projects");
  const projects = await listProjects();

  return (
    <AppShell userEmail={user.email ?? undefined}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Projects"
          description="Every project you own. Open one to manage its issues."
        />

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            New project
          </h2>
          <ProjectCreateForm />
        </Card>

        <Card>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create your first project with the form above. Issues you add to it will show up in the Issues tab."
            />
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Your projects
                  <span className="ml-2 font-normal text-muted">
                    {projects.length}
                  </span>
                </h2>
              </div>
              <ul className="divide-y divide-border">
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    projectId={project.id}
                    name={project.name}
                  />
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
