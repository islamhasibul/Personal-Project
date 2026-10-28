import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { IssueForm } from "@/components/issue-form";
import { IssueTable } from "@/components/issue-table";
import { ProjectRow } from "@/components/project-row";
import { Card, EmptyState, PageHeader, SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/server/auth";
import { listIssuesByProject } from "@/server/issues";
import { getProject } from "@/server/projects";

export const metadata: Metadata = {
  title: "Project · DevDesk",
};

/**
 * A single project: its issues, plus rename and delete.
 *
 * `getProject` returns null for a project that does not exist *or* for one
 * owned by another user, so both cases render a 404.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Project" />
      </AppShell>
    );
  }

  const user = await requireUser();
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  const issues = await listIssuesByProject(project.id);

  // The table expects the project name on every row; here it is always
  // this project, so it is filled in rather than joined.
  const issuesWithProject = issues.map((issue) => ({
    ...issue,
    project_name: project.name,
  }));

  return (
    <AppShell userEmail={user.email ?? undefined}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={project.name}
          description={`${issues.length} ${
            issues.length === 1 ? "issue" : "issues"
          } in this project.`}
          actions={
            <Link href="/projects" className={SECONDARY_BUTTON_CLASS}>
              All projects
            </Link>
          }
        />

        <Card>
          <ul className="divide-y divide-border">
            <ProjectRow
              projectId={project.id}
              name={project.name}
              returnTo={`/projects/${project.id}`}
            />
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">New issue</h2>
          <IssueForm
            mode="create"
            projects={[{ id: project.id, name: project.name }]}
            returnTo={`/projects/${project.id}`}
          />
        </Card>

        <Card>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Issues
              <span className="ml-2 font-normal text-muted">{issues.length}</span>
            </h2>
          </div>
          {issuesWithProject.length === 0 ? (
            <EmptyState
              title="No issues in this project"
              description="Add one with the form above."
            />
          ) : (
            <IssueTable issues={issuesWithProject} showProject={false} />
          )}
        </Card>
      </div>
    </AppShell>
  );
}
