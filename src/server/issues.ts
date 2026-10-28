import { revalidatePath } from "next/cache";

import { DEFAULT_PRIORITY, DEFAULT_STATUS, PRIORITY_VALUES, STATUSES } from "@/lib/constants";
import type { Priority, Status } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";

/**
 * Issue data access.
 *
 * Same ownership model as projects: every function calls `requireUser()` and
 * queries through the user-scoped client, so RLS decides what is visible.
 * Issues have no `owner_id` of their own -- they inherit ownership from
 * their project, and the RLS policies resolve through `projects.owner_id`.
 */

/** An issue as the UI needs it. */
export type Issue = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: number;
  created_at: string;
  updated_at: string;
};

/** An issue plus the name of the project it belongs to. */
export type IssueWithProject = Issue & {
  project_name: string;
};

/** The maximum length the database allows for `issues.title`. */
export const ISSUE_TITLE_MAX = 200;

/** The maximum length the database allows for `issues.description`. */
export const ISSUE_DESCRIPTION_MAX = 5000;

/**
 * Validates the status string against the `issue_status` enum.
 *
 * The value comes from a form, so it is checked against the same list the
 * database defines rather than trusted.
 */
export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

/**
 * Validates the priority string and converts it to the stored smallint.
 */
export function toPriorityValue(value: string): Priority | null {
  if ((["low", "medium", "high"] as string[]).includes(value)) {
    return value as Priority;
  }
  return null;
}

/** Per-field validation messages for the issue form. */
export type IssueFieldErrors = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
};

/** The validated, database-ready shape of an issue. */
export type IssueInput = {
  title: string;
  description: string | null;
  status: Status;
  priority: number;
};

/**
 * Normalises and validates the fields of an issue.
 *
 * Returns a per-field error map so the form can point at the offending
 * input. The database constraints are the backstop; this gives the user a
 * useful message first.
 */
export function validateIssueFields(fields: {
  title: string;
  description: string;
  status: string;
  priority: string;
}): { ok: true; value: IssueInput } | { ok: false; errors: IssueFieldErrors } {
  const errors: IssueFieldErrors = {};

  const title = fields.title.trim();
  if (!title) {
    errors.title = "Title is required.";
  } else if (title.length > ISSUE_TITLE_MAX) {
    errors.title = `Title must be at most ${ISSUE_TITLE_MAX} characters.`;
  }

  const description = fields.description.trim();
  if (description.length > ISSUE_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${ISSUE_DESCRIPTION_MAX} characters.`;
  }

  const status = fields.status;
  if (!isStatus(status)) {
    errors.status = "Choose a valid status.";
  }

  const priority = fields.priority;
  if (!toPriorityValue(priority)) {
    errors.priority = "Choose a valid priority.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title,
      description: description ? description : null,
      status: status as Status,
      priority: PRIORITY_VALUES[toPriorityValue(priority) as Priority],
    },
  };
}

/**
 * The project name from an embedded `projects(name)` relation.
 *
 * PostgREST returns an embedded to-one relation as an array, so the shape
 * is `[{ name }]`. The array is empty when the related project is not
 * visible to the current user, which is what RLS produces.
 */
function projectNameFromEmbed(embed: unknown): string {
  if (Array.isArray(embed)) {
    const first = embed[0] as { name?: unknown } | undefined;
    return typeof first?.name === "string" ? first.name : "Unknown project";
  }
  if (embed && typeof embed === "object") {
    const name = (embed as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "Unknown project";
}

/**
 * Lists the signed-in user's issues, optionally filtered by status.
 *
 * The join to `projects` brings back the project name for the table. RLS
 * applies to both sides of the join, so an issue in someone else's project
 * is invisible here too.
 */
export async function listIssues(status?: Status): Promise<IssueWithProject[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase
    .from("issues")
    .select("id, project_id, title, description, status, priority, created_at, updated_at, projects(name)")
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load issues: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const project = projectNameFromEmbed(row.projects);
    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status as Status,
      priority: row.priority,
      created_at: row.created_at,
      updated_at: row.updated_at,
      project_name: project,
    } satisfies IssueWithProject;
  });
}

/**
 * Lists the issues inside one project.
 */
export async function listIssuesByProject(
  projectId: string,
): Promise<Issue[]> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("issues")
    .select("id, project_id, title, description, status, priority, created_at, updated_at")
    .eq("project_id", projectId)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load issues: ${error.message}`);
  }

  return (data ?? []) as Issue[];
}

/**
 * Loads a single issue by id, with its project name.
 */
export async function getIssue(issueId: string): Promise<IssueWithProject | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("issues")
    .select("id, project_id, title, description, status, priority, created_at, updated_at, projects(name)")
    .eq("id", issueId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load issue: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    project_id: data.project_id,
    title: data.title,
    description: data.description,
    status: data.status as Status,
    priority: data.priority,
    created_at: data.created_at,
    updated_at: data.updated_at,
    project_name: projectNameFromEmbed(data.projects),
  } satisfies IssueWithProject;
}

/**
 * Creates an issue inside a project.
 *
 * The project id is validated against the user's own projects before the
 * insert, so the user gets a clear message rather than an RLS rejection.
 * The INSERT policy's WITH CHECK is still the real enforcement point.
 */
export async function createIssue(fields: {
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
}): Promise<Issue> {
  const user = await requireUser();
  const supabase = await createClient();

  const validated = validateIssueFields(fields);
  if (!validated.ok) {
    throw new Error(Object.values(validated.errors)[0] ?? "Invalid issue.");
  }

  // Confirm the target project belongs to the user.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", fields.projectId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Could not load project: ${projectError.message}`);
  }

  if (!project) {
    throw new Error("That project does not exist.");
  }

  const { data, error } = await supabase
    .from("issues")
    .insert({
      project_id: fields.projectId,
      title: validated.value.title,
      description: validated.value.description,
      status: validated.value.status,
      priority: validated.value.priority,
    })
    .select("id, project_id, title, description, status, priority, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not create issue: ${error.message}`);
  }

  revalidatePath("/issues");
  revalidatePath(`/projects/${fields.projectId}`);
  return data as Issue;
}

/**
 * Updates an issue.
 *
 * `project_id` is deliberately not accepted here: an issue stays in the
 * project it was created in. The UPDATE policy's WITH CHECK validates the
 * resulting `project_id` regardless, but the function never exposes a way
 * to change it.
 */
export async function updateIssue(
  issueId: string,
  fields: {
    title: string;
    description: string;
    status: string;
    priority: string;
  },
): Promise<Issue> {
  await requireUser();

  const validated = validateIssueFields(fields);
  if (!validated.ok) {
    throw new Error(Object.values(validated.errors)[0] ?? "Invalid issue.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .update({
      title: validated.value.title,
      description: validated.value.description,
      status: validated.value.status,
      priority: validated.value.priority,
    })
    .eq("id", issueId)
    .select("id, project_id, title, description, status, priority, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not update issue: ${error.message}`);
  }

  // No row means RLS filtered it out: the issue is not the user's.
  if (!data) {
    throw new Error("That issue no longer exists.");
  }

  revalidatePath("/issues");
  revalidatePath(`/issues/${issueId}`);
  revalidatePath(`/projects/${data.project_id}`);
  return data as Issue;
}

/**
 * Deletes an issue.
 *
 * Only the issue is deleted. The project it belongs to is untouched.
 */
export async function deleteIssue(issueId: string): Promise<void> {
  await requireUser();
  const supabase = await createClient();

  // Read the project id first so the affected project page can be
  // revalidated. RLS means this returns null for another user's issue.
  const { data: existing } = await supabase
    .from("issues")
    .select("project_id")
    .eq("id", issueId)
    .maybeSingle();

  const { error, count } = await supabase
    .from("issues")
    .delete({ count: "exact" })
    .eq("id", issueId);

  if (error) {
    throw new Error(`Could not delete issue: ${error.message}`);
  }

  if (!count) {
    throw new Error("That issue no longer exists.");
  }

  revalidatePath("/issues");
  if (existing) {
    revalidatePath(`/projects/${existing.project_id}`);
  }
}

/** The default values a new issue form starts with. */
export const ISSUE_FORM_DEFAULTS = {
  status: DEFAULT_STATUS,
  priority: DEFAULT_PRIORITY,
};
