import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { IssueForm } from "@/components/issue-form";
import { IssueDeleteButton } from "@/components/issue-delete-button";
import { PriorityBadge, StatusBadge } from "@/components/issue-badges";
import { Card, PageHeader, SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/server/auth";
import { getIssue } from "@/server/issues";

export const metadata: Metadata = {
  title: "Issue · DevDesk",
};

/**
 * A single issue: its details and the edit form.
 *
 * `getIssue` returns null for an issue that does not exist *or* for one
 * owned by another user -- RLS makes the two cases indistinguishable, and
 * both render a 404 rather than leaking whether the issue exists.
 */
export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <PageHeader title="Issue" />
      </AppShell>
    );
  }

  const user = await requireUser();
  const { id } = await params;
  const issue = await getIssue(id);

  if (!issue) {
    notFound();
  }

  return (
    <AppShell userEmail={user.email ?? undefined}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={issue.title}
          description={`In ${issue.project_name}`}
          actions={
            <>
              <Link href="/issues" className={SECONDARY_BUTTON_CLASS}>
                Back to issues
              </Link>
              <IssueDeleteButton issueId={issue.id} title={issue.title} />
            </>
          }
        />

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            <Link
              href={`/projects/${issue.project_id}`}
              className="text-muted underline-offset-4 hover:underline"
            >
              {issue.project_name}
            </Link>
          </div>

          {issue.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">
              {issue.description}
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted">No description.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Edit issue</h2>
          <IssueForm
            mode="edit"
            issue={{
              id: issue.id,
              project_id: issue.project_id,
              title: issue.title,
              description: issue.description,
              status: issue.status,
              priority: issue.priority,
            }}
          />
        </Card>
      </div>
    </AppShell>
  );
}
