# DevDesk — Implementation Plan

**Version:** 3.0 (draft for review)
**Basis:** PRD v1.3, reduced MVP scope
**Target:** working end-to-end MVP in **10–12 hours** (including debugging)
**Status:** Awaiting explicit approval. **No application code, no dependencies installed, no migrations applied, no database changes.** Planning only.

---

## 1. Scope

A small, real, working issue tracker. Everything below is **in**; everything else is **out**.

**In scope**
1. Next.js App Router + TypeScript + Tailwind CSS + Supabase.
2. Auth: sign up, log in, log out.
3. Projects: create, list, rename, delete.
4. Issues: create, list, edit, delete. Fields: **title, description, status, priority**.
5. Dashboard: a table of issues + basic status filtering.
6. RLS on all user tables + server-side authorization.
7. Basic tests, lint, type checking, production build, short README.

**Explicitly out of scope** — do not build, do not stub, do not add UI for any of these:
comments · Kanban board · search · pagination · labels · issue type (bug/feature/task) · keyboard shortcuts · URL-persisted filter state · dark mode · issue moving between projects · OAuth · teams/workspaces · billing · GitHub integration.

**Non-negotiable constraints**
- RLS enabled on every user table; ownership enforced **in the database**.
- Server-side authorization on every server action (`requireUser()`).
- **No service-role key in application code.** Only the URL and the anon/public key go in `.env.local`.
- `priority` stored as `smallint` — **1 = low, 2 = medium, 3 = high**.
- Signup trigger uses a separate `RETURNS trigger` wrapper calling `public.initialize_devdesk_user(NEW.id)`.
- App lives at the **repository root**.
- Short README.

---

## 2. Repository state (checked 2026-10-26)

| Item | State |
|---|---|
| Git repository | **Does not exist** — `git init` is a Phase 1 task |
| Branch / commits | None |
| Working tree | Not applicable |
| Files present | `IMPLEMENTATION_PLAN.md` only |
| Application code | None — no `package.json`, no `src/`, no `.env` |

Nothing pre-existing will be overwritten or deleted. `IMPLEMENTATION_PLAN.md` is updated in place.

---

## 3. Time budget

| Phase | Work | Hours | Cumulative |
|---|---|---|---|
| 1 | Project setup | 1.0 | 1.0 |
| 2 | Database and security | 1.5 | 2.5 |
| 3 | Authentication | 1.5 | 4.0 |
| 4 | Project management | 1.0 | 5.0 |
| 5 | Issue tracking and dashboard | 2.5 | 7.5 |
| 6 | Testing and security verification | 1.5 | 9.0 |
| 7 | Final polish and delivery | 1.0 | 10.0 |
| — | **Debugging buffer** (carried inside each phase) | **1.5–2.0** | **11.5–12.0** |
| | **Total** | **11.5–12.0** | |

The 1.5–2 h buffer covers the friction that always eats a weekend: the first migration failing, cookie/session debugging, and one "why isn't this row appearing" hour. It is already distributed across the phases above rather than parked at the end, so it gets spent on the phase that needs it.

**Assumption:** one developer, focused, Supabase Cloud reachable. See risk R1.

---

## 4. Target layout (app at repository root)

```
C:\Users\BS00973\Downloads\personal project\
├─ .env.example              # placeholders, committed
├─ .env.local                # gitignored
├─ .gitignore
├─ README.md
├─ package.json · next.config.ts · tsconfig.json
├─ tailwind.config.ts · postcss.config.mjs · eslint.config.mjs · vitest.config.ts
├─ supabase/
│  └─ migrations/
│     ├─ 001_schema.sql      # tables, types, indexes
│     ├─ 002_triggers.sql    # updated_at, init function, trigger wrapper
│     └─ 003_rls.sql         # enable RLS + policies
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx · globals.css · page.tsx
│  │  ├─ login/page.tsx · signup/page.tsx
│  │  └─ dashboard/
│  │     ├─ page.tsx              # issue table + status filter
│  │     ├─ projects/page.tsx
│  │     └─ issues/[id]/page.tsx
│  ├─ components/            # IssueForm, IssueTable, ProjectForm, LogoutButton
│  ├─ lib/
│  │  ├─ supabase/{client.ts,server.ts}
│  │  ├─ constants.ts        # statuses + priority values
│  │  └─ types.ts
│  └─ server/
│     ├─ auth.ts             # requireUser()
│     ├─ projects.ts         # server actions
│     └─ issues.ts           # server actions
└─ tests/unit/               # constants + small pure helpers
```

**Simplicity rules**
- No barrel files, no `types/database.ts` generator step, no abstraction over fewer than three call sites.
- A helper used once lives in the file that uses it.
- Server actions live in `src/server/`. The only place a Supabase client is constructed is `src/lib/supabase/`.
- `src/lib/constants.ts` is the single place status and priority values are written down.

---

## 5. Data model, RLS, and the signup trigger

### Tables

**`profiles`** — `id uuid PK` (FK → `auth.users`, CASCADE), `email text`, `created_at timestamptz`

**`projects`** — `id uuid PK`, `owner_id uuid NOT NULL` (FK → `auth.users`, CASCADE), `name text NOT NULL`, `created_at`, `updated_at`

**`issues`** — `id uuid PK`, `project_id uuid NOT NULL` (FK → `projects`, CASCADE), `title text NOT NULL`, `description text`, `status issue_status NOT NULL DEFAULT 'todo'`, `priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3)`, `created_at`, `updated_at`

`issue_status` enum: `todo`, `in_progress`, `done`.
`priority`: **smallint — 1 = low, 2 = medium, 3 = high**, default `2`. The UI maps integers to labels; the database stores the number so ordering is correct in every query with no `CASE` expression.

### Signup initialization — two objects

**1. `public.initialize_devdesk_user(p_user_id uuid)`** — the work function.
- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, schema-qualified names, minimal grants.
- Inserts the profile with `ON CONFLICT (id) DO NOTHING`; creates the "Inbox" project **only if that insert actually created the row**.
- Reads the email from `auth.users`; takes only a user id; never inspects `projects.name`.
- Returns `void`. Callable directly with a user id.

**2. `public.handle_new_user()`** — the **`RETURNS trigger`** wrapper.
- Declared `RETURNS trigger`, `SECURITY DEFINER`, same `search_path` and grants.
- Body: `PERFORM public.initialize_devdesk_user(NEW.id);` then `RETURN NEW;`

**3. The trigger:**
`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`

**Why the wrapper:** Postgres requires a trigger function to return `trigger`, so the work function cannot be the trigger's target directly. The wrapper adapts the call — `NEW.id` → `initialize_devesk_user(uuid)` — and keeps the trigger body to one line.

**Accepted limitation:** the guarantee is **at most one** seeded project per user, not exactly one. If the user deletes "Inbox", it is not recreated. There is no repair path. This is by design for the MVP, not a bug to fix.

### RLS policies

RLS enabled on all three tables. No `anon` access. Every policy uses `auth.uid()`.

| Table | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `profiles` | own row only | trigger only | own row only | trigger only |
| `projects` | `owner_id = auth.uid()` | `owner_id = auth.uid()` | `USING` own + `WITH CHECK` own | `owner_id = auth.uid()` |
| `issues` | exists project owned by me | project owned by me | `USING` via project + `WITH CHECK` validates the resulting `project_id` | via project |

**`USING` vs `WITH CHECK` — the one detail that matters:**
- `USING` is evaluated against the **existing** row → does the user own it right now?
- `WITH CHECK` is evaluated against the **resulting** row → does the row still belong to them after the update?

Both are required on every `UPDATE` policy. Without `WITH CHECK`, a user could set their own issue's `project_id` to another user's project.

**Accept either outcome in tests:** an unauthorized write may **fail with a `42501` error** *or* **affect zero rows**. Assert "the data did not change and the write did not succeed," and accept either. Never require one specific outcome.

### Server-side authorization

- `requireUser()` in `src/server/auth.ts` calls `auth.getUser()` (verified, not `getSession()`) and redirects to `/login` when absent. Every server action calls it.
- Every mutation uses the **user-scoped** client, so RLS is the enforcement point.
- Fields are passed explicitly to each query — no spreading raw request objects into a mutation.
- **No service-role key in application code.** `.env.local` holds only the URL and the anon/public key.

---

## 6. The seven phases

---

### Phase 1 — Project setup (1.0 h)

**Goal:** a running Next.js app with git, Tailwind, and the design skeleton in place.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 1.1 | Verify Node, Git, and **network access to Supabase** (load the dashboard, create a free-tier project). Verify Docker is present but not required | — | Supabase project exists; dashboard loads | 0.25 h |
| 1.2 | `git init` at the repository root; write `.gitignore` (`.env*` except `.env.example`, `node_modules`, `.next`, `build`, `coverage`, editor/OS dirs); first commit containing only `.gitignore` + `IMPLEMENTATION_PLAN.md` | 1.1 | `git status` clean; `.env.local` untracked; repo has one commit | 0.15 h |
| 1.3 | `create-next-app` (App Router, TypeScript, Tailwind, ESLint) **at the repository root**; install `@supabase/ssr`, `@supabase/supabase-js`, `vitest` | 1.2 | `npm run dev` serves a page; deps installed cleanly | 0.35 h |
| 1.4 | `.env.local` (real URL + anon key, gitignored) and `.env.example` (placeholders, committed) | 1.1 | `.env.local` has real values; `.env.example` has none; neither tracked/committed incorrectly | 0.1 h |
| 1.5 | `src/lib/constants.ts` — `STATUSES` (`todo`, `in_progress`, `done`), `PRIORITIES` (`low`, `medium`, `high`) mapped to numeric values (low=1, medium=2, high=3), display-label maps | 1.3 | Exported and referenced by the UI; values match the `smallint` column | 0.1 h |
| 1.6 | Base layout + nav shell (app name, Dashboard link, Projects link, Logout placeholder); `vitest.config.ts`; `npm run test`; `npm run check` = lint + typecheck | 1.3, 1.5 | Shell renders on every page; both scripts run | 0.05 h |

**Phase 1 complete when:** `npm run dev` serves the app, `npm run check` is green, git has an initial commit, `.env.local` is populated and untracked, and network access to Supabase is confirmed.

---

### Phase 2 — Database and security (1.5 h)

**Goal:** schema, triggers, and RLS written, reviewed, and applied. **No application code is written against the database until the SQL is reviewed.**

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 2.1 | Write `supabase/migrations/001_schema.sql`: `pgcrypto`; `issue_status` enum; `profiles`, `projects`, `issues` with FKs `ON DELETE CASCADE`, `CHECK` on title/description length, `priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3)`; indexes on `projects(owner_id)`, `issues(project_id)` | 1.3 | File reads cleanly against §5 of this plan | 0.35 h |
| 2.2 | Write `002_triggers.sql`: `set_updated_at()` + triggers on `projects` and `issues`; `public.initialize_devdesk_user(uuid)`; the separate `public.handle_new_user()` **`RETURNS trigger`** wrapper calling `public.initialize_devdesk_user(NEW.id)`; the `auth.users` INSERT trigger | 2.1 | Same | 0.35 h |
| 2.3 | Write `003_rls.sql`: `ENABLE ROW LEVEL SECURITY` on all three tables + the policy matrix from §5, with both `USING` and `WITH CHECK` on every `UPDATE` | 2.1 | Same | 0.3 h |
| 2.4 | **Review all three SQL files before touching the database** — read each statement against §5: column types, `NOT NULL`, defaults, `CHECK` bounds, cascade behavior, `SECURITY DEFINER` + `search_path` + grants, `USING`/`WITH CHECK` pairing, and that `initialize_devdesk_user` is called with `NEW.id` | 2.1, 2.2, 2.3 | Review checklist ticked; no discrepancies outstanding | 0.2 h |
| 2.5 | Apply the files **in order** via the Supabase Dashboard SQL editor (`001` → `002` → `003`), one at a time | 2.4 | All objects exist; re-pasting a file after a partial failure is harmless | 0.15 h |
| 2.6 | **Schema audit** — open each table and confirm every column, type, default, `CHECK`, FK cascade, and index against §5 | 2.5 | Audit ticked; discrepancies fixed by editing and re-pasting | 0.15 h |

**Phase 2 complete when:** all three files are applied, the schema audit passes, and the SQL has been reviewed before application. **Do not proceed to Phase 3 with unapplied or unreviewed SQL.**

---

### Phase 3 — Authentication (1.5 h)

**Goal:** sign up, log in, log out, and protected routes — with the signup trigger visibly working.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 3.1 | `src/lib/supabase/client.ts` (browser) and `src/lib/supabase/server.ts` (cookie-based, `@supabase/ssr`) | 1.3, 2.5 | Server client reads the session from cookies | 0.3 h |
| 3.2 | `src/middleware.ts`: refresh the session, protect app routes, redirect to `/login` when signed out | 3.1 | `/dashboard` redirects to `/login` when signed out | 0.3 h |
| 3.3 | `/login` and `/signup` pages: email + password, error messages, submit/loading states | 3.1 | A user can sign up and sign in | 0.4 h |
| 3.4 | `src/server/auth.ts` → `requireUser()` (calls `auth.getUser()`); call it from the protected dashboard layout | 3.2 | Signed-out access to any dashboard route redirects | 0.15 h |
| 3.5 | Logout server action + button; redirect to `/login` | 3.4 | Logout works; protected routes then redirect | 0.1 h |
| 3.6 | **Verify the signup trigger in the running app**: sign up → the "Inbox" project exists and is listed | 2.5, 3.3 | "Inbox" visible after signup | 0.1 h |
| 3.7 | Decide the Supabase email-confirmation setting for the dev instance; note it in the README (§10) | 3.3 | Documented; signup works in the chosen mode | 0.15 h |

**Phase 3 complete when:** a user can sign up, land in the app with an "Inbox" project, sign out, sign back in, and cannot reach the dashboard while signed out.

---

### Phase 4 — Project management (1.0 h)

**Goal:** create, list, rename, delete — and the zero-project state.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 4.1 | `src/server/projects.ts`: `createProject`, `listProjects`, `renameProject`, `deleteProject`. Each calls `requireUser()`, uses the user-scoped client, passes explicit fields, validates the name (non-empty, ≤100 chars) | 3.4 | Functions work; RLS is the enforcement point | 0.25 h |
| 4.2 | `/dashboard/projects` page: list the user's projects by name | 4.1 | Projects list renders | 0.1 h |
| 4.3 | Create and rename forms (inline on the projects page is fine) | 4.1 | A project can be created and renamed | 0.2 h |
| 4.4 | Delete with a confirmation naming the project and warning that its issues are deleted with it | 4.1 | Delete works; confirmation shown; issues cascade away | 0.2 h |
| 4.5 | **Zero-project state**: deleting the last project shows a clear "create a project" empty state and disables issue creation | 4.4 | Empty state renders; issue creation blocked; creating a project restores the app | 0.25 h |

**Phase 4 complete when:** projects can be created, listed, renamed, and deleted; the delete cascade removes issues; the zero-project state blocks issue creation and recovers cleanly.

---

### Phase 5 — Issue tracking and dashboard (2.5 h)

**Goal:** the core loop — capture, read, modify, delete issues, and see them in a filterable table.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 5.1 | `src/server/issues.ts`: `createIssue`, `listIssues`, `getIssue`, `updateIssue`, `deleteIssue`. Each calls `requireUser()`; each passes explicit fields; `updateIssue` never accepts `project_id` | 4.1 | Functions work | 0.4 h |
| 5.2 | `IssueForm` component: title (required), description (optional), status select, priority select (1/2/3 mapped to labels). Defaults `todo` / `2` (medium). Reused for create and edit | 1.5 | Renders correctly in both modes | 0.3 h |
| 5.3 | Create-issue UI: project selector (defaults to the first project), submit, redirect to the dashboard | 5.1, 5.2 | An issue can be created with just a title | 0.3 h |
| 5.4 | `IssueTable` component: title, status, priority, project, updated time; each row has Edit and Delete | 5.1 | Table renders rows from props | 0.2 h |
| 5.5 | `/dashboard` page: fetch the signed-in user's issues (**all of them — no pagination**) and render the table | 5.1, 5.4 | Table shows only the signed-in user's issues | 0.2 h |
| 5.6 | **Status filter**: a select above the table (All / todo / in_progress / done), applied server-side | 5.5 | Filtering works | 0.25 h |
| 5.7 | Edit-issue page `/dashboard/issues/[id]`: prefilled form, save, back to the dashboard | 5.1, 5.2 | An issue can be edited and the change persists | 0.3 h |
| 5.8 | Delete-issue with a confirmation; deletes only the issue | 5.1 | Issue disappears from the table | 0.2 h |
| 5.9 | Status and priority changes save and survive a reload | 5.7 | Values persist | 0.35 h |

**Phase 5 complete when:** an issue can be created with only a title, viewed in the dashboard table, filtered by status, edited, and deleted — and all changes persist across reloads.

---

### Phase 6 — Testing and security verification (1.5 h)

**Goal:** prove the data isolation actually works, and pass the quality gates.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 6.1 | Unit tests for `src/lib/constants.ts` (status/priority lists and label maps) and any small pure helper written | 1.5 | `npm run test` green | 0.3 h |
| 6.2 | **Manual RLS verification in the application, with two real accounts.** Create user A and user B (two signups). Signed in as A in the running app: A's dashboard shows only A's issues; A's project list shows only A's projects; A's URL for B's project/issue shows not-found; A cannot edit or delete B's issue; A cannot point their own issue at B's project. Repeat B in a private/incognito window. **Do not test this in the Supabase SQL editor** — the editor runs as the dashboard owner, not as either user, so it does not exercise the policies | 5.5 | All isolation behaviors observed in the app | 0.6 h |
| 6.3 | `npm run lint` — clean | all | No errors | 0.1 h |
| 6.4 | `npm run typecheck` — clean | all | No errors | 0.1 h |
| 6.5 | `npm run build` — production build succeeds | 6.3, 6.4 | Build completes | 0.2 h |
| 6.6 | Confirm no service-role key anywhere in `src/`, and that `.env.local` is gitignored and untracked | all | No service-role usage; `git status` clean | 0.2 h |

**Phase 6 complete when:** the two-account isolation check passes in the app, lint/typecheck/build are green, tests pass, and no service-role key exists in application code. **Do not describe RLS as "verified" without 6.2 actually passing.**

---

### Phase 7 — Final polish and delivery (1.0 h)

**Goal:** a short README, an end-to-end pass, and a committed, working repository.

| # | Task | Depends on | Completion criteria | Time |
|---|---|---|---|---|
| 7.1 | **README** (short): prerequisites · install · Supabase project setup · env vars · **the three SQL files and the order to paste them** · run commands · test commands · known limitations (no comments/board/search/labels/pagination; the email-confirmation choice; the "at most one seeded project" limitation) | all | Someone else can run it from the README alone | 0.4 h |
| 7.2 | **End-to-end manual pass**: sign up → "Inbox" appears → create project → create issue → edit it → filter by status → delete issue → delete project → zero-project state → create project again → log out → log in → data persists | 6.5 | Every step works | 0.3 h |
| 7.3 | Final review against §1 scope: no excluded feature was built, no required one was skipped, no stray files, `.env.local` untracked | 7.1, 7.2 | Nothing half-done; nothing out of scope | 0.15 h |
| 7.4 | Commit | 7.3 | Clean tree; final commit in place | 0.15 h |

**Phase 7 complete when:** the README is accurate, the end-to-end pass is clean, the repository is committed, and the app meets §9.

---

## 7. Cut list (if time runs short)

The required features — authentication, RLS + server-side authorization, project CRUD, issue CRUD, the dashboard table and status filter — are **never cut**. Only optional polish is dropped, in this order:

1. Delete-confirmation copy → keep the delete actions, shorten the wording.
2. Zero-project empty-state prose → keep the state and the create-project action.
3. The `updated_at` column in the table view → the column and its trigger stay; drop it from the view.
4. The description input on the form → the column stays; hide the input.
5. The "All" option in the status filter → default the filter to `todo`.
6. Extra unit tests → keep one test file so `npm test` is meaningful.

---

## 8. Essential risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | **Network to Supabase Cloud fails or is flaky** | Migrations, auth, and every query need it. A bad connection burns hours in confusing errors | Verify at **1.1**, before writing anything. If it fails, stop and ask before switching to a local Supabase/Docker setup — that changes the plan |
| **R2** | **An RLS policy is subtly wrong** | A cross-user data leak. Invisible with one account, because single-user data always looks right | Verify **in the app with two accounts** (6.2), before Phase 7. The SQL editor cannot substitute — it does not run as either user |
| **R3** | **Email confirmation blocks signup testing** | Signup appears to fail; you land nowhere with no error | Decide at 3.7. For a dev instance, **turning it off is the fastest path**; document it in the README as dev-only |
| **R4** | **`priority` as a text enum sorts alphabetically** | "Highest priority first" would show `low` first | Store **`smallint`** — 1=low, 2=medium, 3=high. Ordering is then correct in every query with no `CASE` expression |
| **R5** | **`SECURITY DEFINER` function is over-permissive** | It bypasses RLS; too loose, it could create records for another user | Single `uuid` argument, email read from `auth.users`, safe `search_path`, minimal grants; the `RETURNS trigger` wrapper only passes `NEW.id`. No application code calls either |
| **R6** | **A missing `WITH CHECK` on an `UPDATE` policy** | A user could point their own issue at another user's project | Every `UPDATE` policy gets both `USING` and `WITH CHECK`; reviewed at 2.4 and verified at 6.2 |
| **R7** | **The 10–12 h budget is tight** | The work sums to ~10 h including per-phase debugging | The cut list above drops optional polish only. If Phase 5 overruns, trim polish — never auth, RLS, project CRUD, or issue CRUD |
| **R8** | **A secret gets committed** | Supabase keys in git history | `.env.local` gitignored from the first commit (1.2); treat any committed key as compromised and rotate it |
| **R9** | **Next.js middleware API differs by version** | Task 3.2 may need a small adjustment | Pin the version at install (1.3); the concept is unchanged either way |

**R1 and R2 are the two that can sink the weekend**, and both are front-loaded on purpose: R1 at 1.1, R2's SQL review at 2.4 — before any UI exists to distract from the database work.

---

## 9. What "done" means

- A user signs up, lands in a working app with an "Inbox" project, and can sign in and out.
- They can create, list, rename, and delete projects.
- They can create, list, edit, and delete issues with title, description, status, and priority.
- The dashboard shows a table of their issues with a working status filter.
- Priority is stored as `smallint` (1=low, 2=medium, 3=high) and sorts correctly.
- **No user can see or modify another user's data** — verified in the application with two accounts (6.2) and recorded in the README.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test` all pass.
- No service-role key in application code; no secrets committed.
- The README lets a stranger run the app from scratch, including pasting the three SQL files in order.

---

## 10. One decision for you

**Supabase email confirmation on the dev instance:** turn it **off** (fastest for a 10–12 hour weekend; documented in the README as a dev-only setting) or leave it **on** (honest for production, but signup testing gets slower)?

Recommendation: **off for development**, with a one-line README note on enabling it for production.

---

**End of Implementation Plan v3.0. Awaiting explicit approval before Phase 1 begins.**
