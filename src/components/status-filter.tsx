"use client";

import { STATUSES, STATUS_LABELS } from "@/lib/constants";
import { SELECT_CLASS } from "@/components/ui";

/**
 * The status filter above the issue table.
 *
 * A plain GET form, so the filter is applied server-side by the page and
 * works without JavaScript. The current selection is carried in the URL as
 * `?status=`, which also makes the filtered view linkable.
 *
 * The form auto-submits on change, and the submit button remains as the
 * no-JavaScript fallback.
 *
 * The auto-submit is a React `onChange` handler rather than an inline
 * `<script>`: React does not execute scripts it renders on the client, so an
 * inline script only worked on a full page load and silently did nothing
 * when the user reached this page through a client-side navigation.
 */
export function StatusFilter({ current }: { current: string }) {
  return (
    <form method="get" className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="status-filter" className="text-sm font-medium text-foreground">
          Filter by status
        </label>
        <select
          id="status-filter"
          name="status"
          defaultValue={current}
          className={SELECT_CLASS}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="all">All</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-foreground"
      >
        Apply
      </button>
    </form>
  );
}
