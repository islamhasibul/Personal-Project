-- DevDesk — 003_rls.sql
-- Phase 2, task 2.3: enable Row Level Security on every user-data table and
-- define the policies that enforce ownership.
--
-- Apply order: 001 -> 002 -> 003.
-- This file is idempotent: it can be re-pasted safely after a partial failure.
--
-- Ownership model:
--   * profiles are owned directly by a user (id).
--   * projects are owned directly by a user (owner_id).
--   * issues have no owner column. They inherit ownership from their
--     project, so every issue policy resolves through projects.owner_id.
--
-- auth.uid() returns the id of the user making the request, or NULL for an
-- anonymous request. NULL never equals a column value, so an anonymous
-- request matches no row and can insert/update/delete nothing.

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY turns on the policy engine for the two
-- client-facing roles, anon and authenticated. Every query they issue
-- against these tables is filtered by the policies below. The anon role
-- has no policy at all, so it is denied everything by default.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY -- what it actually does
-- ---------------------------------------------------------------------------
-- FORCE removes the *ordinary* table-owner exemption: an owner is normally
-- exempt from its own table's policies, and FORCE makes the owner subject
-- to them too.
--
-- It does NOT override the BYPASSRLS attribute. Per the PostgreSQL docs:
-- "Superusers and roles with the BYPASSRLS attribute always bypass the row
-- security system when accessing a table." FORCE only removes the ordinary
-- owner exemption; a role holding BYPASSRLS still bypasses the policies.
--
-- Consequences on Supabase:
--   * The `postgres` role holds the `bypassrls` attribute, and
--     `service_role` has BYPASSRLS outright. Both therefore still bypass
--     these policies even with FORCE enabled.
--   * The signup trigger in 002_triggers.sql is a SECURITY DEFINER
--     function owned by the same role as these tables. It relies on that
--     bypass to write the profile and the Inbox project, because
--     auth.uid() is NULL during a signup trigger and the policies would
--     otherwise reject the insert.
--   * FORCE therefore has no effect on the trigger path, PROVIDED the
--     tables and the functions are owned by the same role that holds
--     bypassrls. Applying these migrations as a different owner would put
--     the trigger under policy evaluation and break signup.
--
-- Why keep FORCE at all:
--   It protects against a future owner role that does NOT hold bypassrls.
--   If the table owner were an ordinary role, FORCE would stop that owner
--   from reading or writing every user's data directly, bypassing the
--   policies. It is defense in depth for the ownership model, not a
--   protection against the dashboard owner -- the dashboard owner is
--   postgres and bypasses RLS regardless.
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.issues   FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies: profiles
-- ---------------------------------------------------------------------------
-- The profile row is created by the signup trigger (002_triggers.sql) and
-- the application never inserts or deletes profiles. Only the SELECT and
-- UPDATE policies are granted to the authenticated role; there is no INSERT
-- or DELETE policy, so those operations are denied for every non-trigger
-- role. The trigger itself bypasses RLS because it is SECURITY DEFINER
-- owned by a role holding the bypassrls attribute.

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Policies: projects
-- ---------------------------------------------------------------------------
-- A project is visible and writable only by its owner.

DROP POLICY IF EXISTS projects_select_own ON public.projects;
CREATE POLICY projects_select_own
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS projects_insert_own ON public.projects;
CREATE POLICY projects_insert_own
  ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- USING is evaluated against the existing row: may this user touch a row
-- they already own?
-- WITH CHECK is evaluated against the resulting row: does the row still
-- belong to them after the update? Without WITH CHECK, a user could
-- reassign their project to another user's id and lose access to it, or
-- grant another user access to it. Both are required.
DROP POLICY IF EXISTS projects_update_own ON public.projects;
CREATE POLICY projects_update_own
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS projects_delete_own ON public.projects;
CREATE POLICY projects_delete_own
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Policies: issues
-- ---------------------------------------------------------------------------
-- An issue is owned indirectly: it belongs to a project, and it may be
-- touched only if the current user owns that project. The EXISTS subquery
-- is evaluated per row against projects, which has its own RLS policies,
-- but it is written explicitly rather than relying on that, so the
-- condition stands on its own.

DROP POLICY IF EXISTS issues_select_own ON public.issues;
CREATE POLICY issues_select_own
  ON public.issues
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = issues.project_id
        AND p.owner_id = auth.uid()
    )
  );

-- WITH CHECK validates the *resulting* project_id. A user could otherwise
-- create an issue inside another user's project, or point their own issue
-- at another user's project during an update.
DROP POLICY IF EXISTS issues_insert_own ON public.issues;
CREATE POLICY issues_insert_own
  ON public.issues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = issues.project_id
        AND p.owner_id = auth.uid()
    )
  );

-- USING: may the user touch this issue right now (its current project is
-- theirs)?
-- WITH CHECK: after the update, is the issue still inside a project the
-- user owns? This is the check that blocks "point my issue at user B's
-- project".
DROP POLICY IF EXISTS issues_update_own ON public.issues;
CREATE POLICY issues_update_own
  ON public.issues
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = issues.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = issues.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS issues_delete_own ON public.issues;
CREATE POLICY issues_delete_own
  ON public.issues
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = issues.project_id
        AND p.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Table privileges: anon and authenticated
-- ---------------------------------------------------------------------------
-- RLS decides WHICH rows a role may touch. Table privileges decide WHETHER
-- a role may issue the statement at all. Both must allow access for the
-- request to succeed, so a missing table privilege denies the statement
-- outright and a missing policy filters the rows.
--
-- anon:
--   No GRANT to anon is issued anywhere in this migration set, and no
--   policy is defined TO anon. With RLS enabled and no applicable policy,
--   every statement the anon role issues against these tables is denied.
--   The REVOKE below makes that state explicit and repairs it if the
--   database was previously granted access. It is safe to run: REVOKE only
--   removes a privilege that exists, and is a no-op otherwise.
--
-- authenticated:
--   The authenticated role needs table-level SELECT, INSERT, UPDATE and
--   DELETE to reach the policies at all. Supabase grants these to
--   authenticated by default on tables in the public schema. They are
--   granted explicitly below so the file does not depend on that default
--   holding, and so the intended privilege set is visible in the migration.
--   Note that RLS still restricts WHICH rows are visible and writable --
--   these grants do not widen access past the policies.
--
-- service_role is deliberately NOT granted anything here. It holds the
-- BYPASSRLS attribute and its own table privileges; it bypasses RLS
-- regardless, and no service-role key exists in this project.
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.issues    TO authenticated;

REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.projects  FROM anon;
REVOKE ALL ON public.issues    FROM anon;
