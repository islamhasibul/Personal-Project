"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createProject,
  deleteProject,
  normalizeProjectName,
  renameProject,
} from "@/server/projects";
import { resolveRedirectTarget } from "@/server/redirect";

/**
 * Form-facing project actions.
 *
 * These wrap the data-access functions in `src/server/projects.ts` so the
 * form components get a predictable result shape: either an error message
 * to display, or a redirect to the page that shows the outcome.
 */

export type ProjectActionState = {
  error?: string;
  success?: string;
};

export type ProjectActionResult = ProjectActionState | undefined;

/**
 * Creates a project from a form submission.
 *
 * On success it redirects to the projects list, so the new project appears
 * and the form is cleared. A redirect ends the action, which is why the
 * function is typed as returning `never` on that path.
 */
export async function createProjectAction(
  _prev: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> {
  const name = String(formData.get("name") ?? "");

  const normalized = normalizeProjectName(name);
  if (!normalized.ok) {
    return { error: normalized.error };
  }

  try {
    await createProject(normalized.value);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the project. Please try again.",
    };
  }

  redirect("/projects");
}

/**
 * Renames a project from a form submission.
 *
 * `returnTo` says where to go afterwards. A rename can be started from the
 * projects list or from the project's own page, and the user should end up
 * back where they started: renaming a project from its own page and then
 * being dropped on the list hides the very thing that just changed.
 */
export async function renameProjectAction(
  _prev: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");

  if (!projectId) {
    return { error: "Missing project id." };
  }

  const normalized = normalizeProjectName(name);
  if (!normalized.ok) {
    return { error: normalized.error };
  }

  try {
    await renameProject(projectId, normalized.value);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not rename the project. Please try again.",
    };
  }

  redirect(resolveRedirectTarget(returnTo, "/projects"));
}

/**
 * Deletes a project from a form submission.
 *
 * The project id is read from the form, but RLS decides whether the delete
 * is allowed: a project owned by another user matches no row, and the
 * count comes back zero.
 */
export async function deleteProjectAction(
  _prev: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> {
  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) {
    return { error: "Missing project id." };
  }

  try {
    await deleteProject(projectId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not delete the project. Please try again.",
    };
  }

  revalidatePath("/projects");
  redirect("/projects");
}
