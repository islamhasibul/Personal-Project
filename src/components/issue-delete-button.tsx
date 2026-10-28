"use client";

import { useActionState } from "react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DANGER_BUTTON_CLASS } from "@/components/ui";
import { deleteIssueAction, type IssueActionResult } from "@/server/issues-actions";

/**
 * Delete control for a single issue.
 *
 * The confirmation names the issue so the prompt is unambiguous, and the
 * action deletes only the issue -- never its project.
 */
export function IssueDeleteButton({
  issueId,
  title,
}: {
  issueId: string;
  title: string;
}) {
  const [state, formAction] = useActionState<
    IssueActionResult,
    FormData
  >(deleteIssueAction, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="issueId" value={issueId} />
        <ConfirmSubmitButton
          className={DANGER_BUTTON_CLASS}
          pendingLabel="Deleting..."
          message={`Delete "${title}"? This cannot be undone.`}
        >
          Delete
        </ConfirmSubmitButton>
      </form>
      {state?.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
