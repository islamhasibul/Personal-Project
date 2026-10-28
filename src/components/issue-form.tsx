"use client";

import { useActionState } from "react";

import {
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/ui";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  STATUSES,
  STATUS_LABELS,
  type Priority,
  type Status,
} from "@/lib/constants";
import {
  createIssueAction,
  updateIssueAction,
  type IssueActionResult,
} from "@/server/issues-actions";

/** A project the issue can be filed under. */
export type ProjectOption = {
  id: string;
  name: string;
};

/**
 * The issue form, used for both creating and editing.
 *
 * The difference between the two modes is the action, the hidden fields,
 * and whether the project selector is shown. The fields themselves are
 * identical, so the validation and the layout cannot drift apart.
 */
export function IssueForm({
  mode,
  projects,
  issue,
  returnTo,
}: {
  mode: "create" | "edit";
  /** The user's projects. Only used in create mode. */
  projects?: ProjectOption[];
  /** The issue being edited. Only used in edit mode. */
  issue?: {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    status: Status;
    priority: number;
  };
  /**
   * The page this form lives on; where a create returns to. Only used in
   * create mode -- editing always happens on the issue's own page.
   */
  returnTo?: string;
}) {
  const action = mode === "create" ? createIssueAction : updateIssueAction;
  const [state, formAction, isPending] = useActionState<
    IssueActionResult,
    FormData
  >(action, undefined);

  const fieldErrors = state?.fieldErrors;
  const isEdit = mode === "edit";

  // The default project is the first one in the list, so creating an issue
  // needs nothing but a title.
  const defaultProjectId = issue?.project_id ?? projects?.[0]?.id ?? "";

  // The stored priority is a smallint; the form works with the name.
  const defaultPriority =
    PRIORITIES.find(
      (p) =>
        PRIORITY_VALUES[p] ===
        (issue?.priority ?? PRIORITY_VALUES.medium),
    ) ?? "medium";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit && issue ? (
        <input type="hidden" name="issueId" value={issue.id} />
      ) : null}

      {!isEdit && returnTo ? (
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}

      {state?.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      ) : null}

      {!isEdit ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="issue-project" className="text-sm font-medium text-foreground">
            Project
          </label>
          <select
            id="issue-project"
            name="projectId"
            defaultValue={defaultProjectId}
            required
            className={SELECT_CLASS}
          >
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="issue-title" className="text-sm font-medium text-foreground">
          Title
        </label>
        <input
          id="issue-title"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={issue?.title ?? ""}
          placeholder="What needs to be done?"
          aria-invalid={fieldErrors?.title ? true : undefined}
          aria-describedby={fieldErrors?.title ? "issue-title-error" : undefined}
          className={INPUT_CLASS}
        />
        {fieldErrors?.title ? (
          <p id="issue-title-error" role="alert" className="text-xs text-red-600">
            {fieldErrors.title}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="issue-description"
          className="text-sm font-medium text-foreground"
        >
          Description
          <span className="ml-1 font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="issue-description"
          name="description"
          rows={4}
          maxLength={5000}
          defaultValue={issue?.description ?? ""}
          placeholder="Add any details that help."
          aria-invalid={fieldErrors?.description ? true : undefined}
          aria-describedby={
            fieldErrors?.description ? "issue-description-error" : undefined
          }
          className={`${INPUT_CLASS} resize-y`}
        />
        {fieldErrors?.description ? (
          <p
            id="issue-description-error"
            role="alert"
            className="text-xs text-red-600"
          >
            {fieldErrors.description}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-36 flex-1 flex-col gap-1.5">
          <label htmlFor="issue-status" className="text-sm font-medium text-foreground">
            Status
          </label>
          <select
            id="issue-status"
            name="status"
            defaultValue={issue?.status ?? "todo"}
            className={SELECT_CLASS}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {fieldErrors?.status ? (
            <p role="alert" className="text-xs text-red-600">
              {fieldErrors.status}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-36 flex-1 flex-col gap-1.5">
          <label htmlFor="issue-priority" className="text-sm font-medium text-foreground">
            Priority
          </label>
          <select
            id="issue-priority"
            name="priority"
            defaultValue={defaultPriority}
            className={SELECT_CLASS}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
          {fieldErrors?.priority ? (
            <p role="alert" className="text-xs text-red-600">
              {fieldErrors.priority}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <button type="submit" disabled={isPending} className={PRIMARY_BUTTON_CLASS}>
          {isPending
            ? isEdit
              ? "Saving..."
              : "Creating..."
            : isEdit
              ? "Save changes"
              : "Create issue"}
        </button>
      </div>
    </form>
  );
}

/**
 * Priority name for a stored smallint.
 *
 * The database stores 1/2/3; the UI shows Low/Medium/High. Kept here
 * because both the table and the badges need it.
 */
export function priorityLabel(priority: number): string {
  const name = PRIORITIES.find((p) => PRIORITY_VALUES[p] === priority) as
    | Priority
    | undefined;
  return name ? PRIORITY_LABELS[name] : PRIORITY_LABELS.medium;
}
