"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createIssue, deleteIssue, updateIssue, validateIssueFields } from "@/server/issues";
import { resolveRedirectTarget } from "@/server/redirect";

/**
 * Form-facing issue actions.
 *
 * Each returns a predictable result shape so the form components can show
 * an inline error and a per-field error map.
 */

export type IssueActionState = {
  error?: string;
  fieldErrors?: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
  };
};

export type IssueActionResult = IssueActionState | undefined;

/**
 * Creates an issue from a form submission.
 *
 * `projectId` comes from a select populated with the user's own projects,
 * so the user can only create an issue in a project they own. The database
 * enforces that too.
 *
 * `returnTo` says where to go afterwards. An issue can be created from the
 * issues list or from a project's own page, and the user should end up back
 * where they started, so the new issue is visible in the table they were
 * looking at.
 */
export async function createIssueAction(
  _prev: IssueActionResult,
  formData: FormData,
): Promise<IssueActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "");
  const description = String(formData.get("description") ?? "");
  const status = String(formData.get("status") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");

  if (!projectId) {
    return { error: "Choose a project for the issue." };
  }

  const validated = validateIssueFields({ title, description, status, priority });
  if (!validated.ok) {
    return { fieldErrors: validated.errors };
  }

  try {
    await createIssue({ projectId, title, description, status, priority });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the issue. Please try again.",
    };
  }

  redirect(resolveRedirectTarget(returnTo, "/issues"));
}

/**
 * Updates an issue from a form submission.
 *
 * The issue id is read from the form; RLS decides whether the row is
 * visible and writable.
 */
export async function updateIssueAction(
  _prev: IssueActionResult,
  formData: FormData,
): Promise<IssueActionResult> {
  const issueId = String(formData.get("issueId") ?? "");
  const title = String(formData.get("title") ?? "");
  const description = String(formData.get("description") ?? "");
  const status = String(formData.get("status") ?? "");
  const priority = String(formData.get("priority") ?? "");

  if (!issueId) {
    return { error: "Missing issue id." };
  }

  const validated = validateIssueFields({ title, description, status, priority });
  if (!validated.ok) {
    return { fieldErrors: validated.errors };
  }

  try {
    await updateIssue(issueId, { title, description, status, priority });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not update the issue. Please try again.",
    };
  }

  redirect("/issues");
}

/**
 * Deletes an issue from a form submission.
 */
export async function deleteIssueAction(
  _prev: IssueActionResult,
  formData: FormData,
): Promise<IssueActionResult> {
  const issueId = String(formData.get("issueId") ?? "");

  if (!issueId) {
    return { error: "Missing issue id." };
  }

  try {
    await deleteIssue(issueId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not delete the issue. Please try again.",
    };
  }

  revalidatePath("/issues");
  redirect("/issues");
}
