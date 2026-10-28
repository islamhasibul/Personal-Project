import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { IssueForm } from "@/components/issue-form";
import { IssueTable } from "@/components/issue-table";
import { StatusFilter } from "@/components/status-filter";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { STATUSES, type Status } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/server/auth";
import { listIssues } from "@/server/issues";
import { listProjects } from "@/server/projects";

export const metadata: Metadata = {
  title: "Issues · DevDesk",
};

/**
 * The issues list.
 *
 * Every issue the signed-in user owns, with a status filter applied
 * server-side from the `?status=` query parameter.
 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Issues" />
        <Card className="mt-6 p-4 text-sm text-muted">
          Supabase is not configured. Set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          in <code className="font-mono text-xs">.env.local</code> to enable
          issues.
        </Card>
      </AppShell>
    );
  }

  const user = await requireUser("/issues");
  const { status: statusParam } = await searchParams;

  // Only accept a status the database knows about; anything else means
  // "no filter" rather than an empty table.
  const status: Status | undefined = (STATUSES as readonly string[]).includes(
    statusParam ?? "",
  )
    ? (statusParam as Status)
    : undefined;

  const [issues, projects] = await Promise.all([listIssues(status), listProjects()]);

  const filterValue = status ?? "all";

  return (
    <AppShell userEmail={user.email ?? undefined}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Issues"
          description="All the issues across your projects."
        />

        {projects.length === 0 ? (
          <Card>
            <EmptyState
              title="No projects yet"
              description="Issues live inside a project. Create a project first, then add issues to it."
              action={
                <Link
                  href="/projects"
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                >
                  Go to projects
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                New issue
              </h2>
              <IssueForm
                mode="create"
                projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                returnTo="/issues"
              />
            </Card>

            <Card>
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {status ? `Issues · ${status}` : "All issues"}
                    <span className="ml-2 font-normal text-muted">
                      {issues.length}
                    </span>
                  </h2>
                </div>
                <StatusFilter current={filterValue} />
              </div>

              {issues.length === 0 ? (
                <EmptyState
                  title={status ? "No issues with that status" : "No issues yet"}
                  description={
                    status
                      ? "Try a different status filter, or change the status of an existing issue."
                      : "Create your first issue with the form above."
                  }
                />
              ) : (
                <IssueTable issues={issues} />
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
