"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  DANGER_BUTTON_CLASS,
  INPUT_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import {
  deleteProjectAction,
  renameProjectAction,
  type ProjectActionResult,
} from "@/server/projects-actions";

/**
 * One project in the projects list.
 *
 * The row shows the project name and its actions. Editing is inline and
 * toggled by a button, so the list stays a single column and no separate
 * edit page is needed.
 *
 * `returnTo` is the page the row is rendered on. After a rename the action
 * sends the user back there, so renaming a project from its own page keeps
 * the new name in view instead of dropping the user on the list.
 */
export function ProjectRow({
  projectId,
  name,
  returnTo = "/projects",
}: {
  projectId: string;
  name: string;
  /** The page this row lives on; where a rename returns to. */
  returnTo?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const [renameState, renameAction, isRenaming] = useActionState<
    ProjectActionResult,
    FormData
  >(renameProjectAction, undefined);

  const [deleteState, deleteAction] = useActionState<
    ProjectActionResult,
    FormData
  >(deleteProjectAction, undefined);

  if (isEditing) {
    return (
      <li className="flex flex-col gap-3 px-4 py-3">
        <form action={renameAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor={`rename-${projectId}`} className="sr-only">
              Project name
            </label>
            <input
              id={`rename-${projectId}`}
              name="name"
              type="text"
              required
              maxLength={100}
              defaultValue={name}
              autoFocus
              aria-invalid={renameState?.error ? true : undefined}
              className={INPUT_CLASS}
            />
          </div>
          <button
            type="submit"
            disabled={isRenaming}
            className={SECONDARY_BUTTON_CLASS}
          >
            {isRenaming ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
        </form>
        {renameState?.error ? (
          <p role="alert" className="text-sm text-red-600">
            {renameState.error}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${projectId}`}
          className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {name}
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={SECONDARY_BUTTON_CLASS}
        >
          Rename
        </button>
      </div>

      <form action={deleteAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <ConfirmSubmitButton
          className={DANGER_BUTTON_CLASS}
          pendingLabel="Deleting..."
          message={`Delete "${name}"? Its issues will be deleted too. This cannot be undone.`}
        >
          Delete
        </ConfirmSubmitButton>
      </form>

      {deleteState?.error ? (
        <p role="alert" className="w-full text-sm text-red-600">
          {deleteState.error}
        </p>
      ) : null}
    </li>
  );
}
