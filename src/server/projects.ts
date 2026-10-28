import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";

/**
 * Project data access.
 *
 * Every function here calls `requireUser()` first and then queries through
 * the user-scoped Supabase client. That client carries the signed-in user's
 * JWT, so the database applies the RLS policies from
 * `supabase/migrations/003_rls.sql`: a query for another user's project
 * returns nothing, and a write to it is rejected. The application never
 * checks ownership by hand, and there is no service-role client.
 */

/** A project as the UI needs it. */
export type Project = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

/** The maximum length the database allows for `projects.name`. */
export const PROJECT_NAME_MAX = 100;

/**
 * Normalises and validates a project name.
 *
 * The database has a CHECK constraint of 1..100 characters, but validating
 * here means the user gets an inline message instead of a constraint
 * violation.
 */
export function normalizeProjectName(raw: string): {
  ok: true;
  value: string;
} | {
  ok: false;
  error: string;
} {
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: "Project name is required." };
  }
  if (value.length > PROJECT_NAME_MAX) {
    return {
      ok: false,
      error: `Project name must be at most ${PROJECT_NAME_MAX} characters.`,
    };
  }
  return { ok: true, value };
}

/**
 * Lists the signed-in user's projects, newest first.
 *
 * `owner_id` is included in the filter as well as relying on RLS. The
 * explicit filter is not a substitute for RLS -- it just narrows the result
 * set before the policy is applied.
 */
export async function listProjects(): Promise<Project[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load projects: ${error.message}`);
  }

  return (data ?? []) as Project[];
}

/**
 * Loads a single project by id.
 *
 * Returns null when the project does not exist or belongs to another user --
 * RLS makes those two cases indistinguishable, which is the point.
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at, updated_at")
    .eq("id", projectId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load project: ${error.message}`);
  }

  return (data as Project | null) ?? null;
}

/**
 * Creates a project owned by the signed-in user.
 *
 * `owner_id` is taken from the verified session, never from the form, so a
 * user cannot create a project owned by somebody else.
 */
export async function createProject(name: string): Promise<Project> {
  const user = await requireUser();
  const trimmed = normalizeProjectName(name);
  if (!trimmed.ok) {
    throw new Error(trimmed.error);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: user.id,
      name: trimmed.value,
    })
    .select("id, name, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not create project: ${error.message}`);
  }

  revalidatePath("/projects");
  return data as Project;
}

/**
 * Renames a project.
 *
 * The UPDATE policy has both USING and WITH CHECK, so the row must belong
 * to the user before the update and after it.
 */
export async function renameProject(
  projectId: string,
  name: string,
): Promise<Project> {
  await requireUser();
  const trimmed = normalizeProjectName(name);
  if (!trimmed.ok) {
    throw new Error(trimmed.error);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ name: trimmed.value })
    .eq("id", projectId)
    .select("id, name, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not rename project: ${error.message}`);
  }

  // No row means the project is not the user's (or no longer exists). RLS
  // filtered it out, so there is nothing to rename.
  if (!data) {
    throw new Error("That project no longer exists.");
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return data as Project;
}

/**
 * Deletes a project.
 *
 * Deleting a project cascades to its issues: `issues.project_id` is
 * `ON DELETE CASCADE`. That is destructive, so the UI asks for confirmation
 * first and names the project in the prompt.
 */
export async function deleteProject(projectId: string): Promise<void> {
  await requireUser();
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", projectId);

  if (error) {
    throw new Error(`Could not delete project: ${error.message}`);
  }

  if (!count) {
    throw new Error("That project no longer exists.");
  }

  revalidatePath("/projects");
  revalidatePath("/issues");
}
