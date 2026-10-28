import Link from "next/link";

import { IssueDeleteButton } from "@/components/issue-delete-button";
import { PriorityBadge, StatusBadge } from "@/components/issue-badges";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui";
import type { IssueWithProject } from "@/server/issues";

/**
 * Formats an ISO timestamp as a short local date.
 *
 * The value is rendered on the server and on the client from the same
 * string, so there is no hydration mismatch: the format is fixed and
 * timezone-independent.
 */
function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const day = date.toLocaleString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  });
  const year = date.toLocaleString("en-US", {
    year: "numeric",
    timeZone: "UTC",
  });
  return `${month} ${day}, ${year}`;
}

/**
 * The table of issues.
 *
 * Each row shows the title, project, status, priority and updated date,
 * with an Edit link and a Delete button. The table is scrollable on narrow
 * screens rather than wrapping into a broken layout.
 */
export function IssueTable({
  issues,
  showProject = true,
}: {
  issues: IssueWithProject[];
  /** Hidden on the project page, where every issue is in the same project. */
  showProject?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-4 py-2.5 font-medium text-muted">
              Title
            </th>
            {showProject ? (
              <th scope="col" className="px-4 py-2.5 font-medium text-muted">
                Project
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2.5 font-medium text-muted">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium text-muted">
              Priority
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium text-muted">
              Updated
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {issues.map((issue) => (
            <tr key={issue.id}>
              <td className="max-w-md px-4 py-3 align-top">
                <Link
                  href={`/issues/${issue.id}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {issue.title}
                </Link>
                {issue.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">
                    {issue.description}
                  </p>
                ) : null}
              </td>
              {showProject ? (
                <td className="px-4 py-3 align-top text-muted">
                  {issue.project_name}
                </td>
              ) : null}
              <td className="px-4 py-3 align-top">
                <StatusBadge status={issue.status} />
              </td>
              <td className="px-4 py-3 align-top">
                <PriorityBadge priority={issue.priority} />
              </td>
              <td className="px-4 py-3 align-top text-muted">
                {formatUpdatedAt(issue.updated_at)}
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/issues/${issue.id}`}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    Edit
                  </Link>
                  <IssueDeleteButton issueId={issue.id} title={issue.title} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
