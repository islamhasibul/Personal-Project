import { STATUS_LABELS, type Status } from "@/lib/constants";

/**
 * The badge styles for issue status and priority.
 *
 * Kept as plain string constants so both the server-rendered table and the
 * client components use the same colours.
 */
const STATUS_STYLES: Record<Status, string> = {
  todo: "bg-surface text-muted border-border",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-green-50 text-green-700 border-green-200",
};

const PRIORITY_STYLES: Record<number, string> = {
  1: "bg-surface text-muted border-border",
  2: "bg-amber-50 text-amber-700 border-amber-200",
  3: "bg-red-50 text-red-700 border-red-200",
};

/** A coloured badge showing an issue's status. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.todo}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** A coloured badge showing an issue's priority. */
export function PriorityBadge({ priority }: { priority: number }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority] ?? PRIORITY_STYLES[2]}`}
    >
      {priority === 1 ? "Low" : priority === 3 ? "High" : "Medium"}
    </span>
  );
}
