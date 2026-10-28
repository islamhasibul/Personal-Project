"use client";

import { useActionState } from "react";

import { createProjectAction, type ProjectActionResult } from "@/server/projects-actions";
import { INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";

/**
 * Create-project form.
 *
 * The button is disabled while the action is in flight, so a slow request
 * cannot submit the form twice and create two projects with the same name.
 */
export function ProjectCreateForm() {
  const [state, formAction, isPending] = useActionState<
    ProjectActionResult,
    FormData
  >(createProjectAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="text-sm font-medium text-foreground">
          Project name
        </label>
        <input
          id="project-name"
          name="name"
          type="text"
          required
          maxLength={100}
          placeholder="e.g. Marketing website"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "create-project-error" : undefined}
          className={INPUT_CLASS}
        />
      </div>

      {state?.error ? (
        <p
          id="create-project-error"
          role="alert"
          className="text-sm text-red-600"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <button type="submit" disabled={isPending} className={PRIMARY_BUTTON_CLASS}>
          {isPending ? "Creating..." : "Create project"}
        </button>
      </div>
    </form>
  );
}
