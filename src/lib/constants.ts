/**
 * Single source of truth for issue status and priority values.
 *
 * The database stores `status` as the `issue_status` enum and `priority`
 * as a `smallint`. These constants mirror both exactly, so the UI and the
 * database never disagree.
 */

/** Matches the `issue_status` enum in migrations/001_schema.sql. */
export const STATUSES = ["todo", "in_progress", "done"] as const;

export type Status = (typeof STATUSES)[number];

/**
 * Priority is stored as a smallint: 1 = low, 2 = medium, 3 = high.
 * Storing the number (not the label) means ordering by priority is
 * correct in every query with no CASE expression.
 */
export const PRIORITIES = ["low", "medium", "high"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_VALUES: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const STATUS_LABELS: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** The value a new issue gets for each field. */
export const DEFAULT_STATUS: Status = "todo";
export const DEFAULT_PRIORITY: Priority = "medium";

/** Maps a stored smallint back to its priority name. */
export function priorityFromValue(value: number): Priority {
  const match = PRIORITIES.find((p) => PRIORITY_VALUES[p] === value);
  return match ?? DEFAULT_PRIORITY;
}
