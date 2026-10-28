-- DevDesk — combined setup
-- Phase 2, tasks 2.1 + 2.2 + 2.3, merged into one script.
--
-- This file is the concatenation of the three phase-2 migrations, in the
-- order they must be applied:
--
--   001_schema.sql    -> tables, types, constraints, relationships, indexes
--   002_triggers.sql  -> updated_at triggers, signup initialization, auth trigger
--   003_rls.sql       -> row level security and policies
--
-- Apply order: 001 -> 002 -> 003. The sections below are marked with
-- section headers so the original three files can be read back individually.
--
-- This file is idempotent: it can be re-pasted safely after a partial failure.
--
-- IMPORTANT: run this as the role that owns both the tables and the
-- SECURITY DEFINER functions (normally `postgres`). The signup trigger
-- path in section 2 relies on that role holding the `bypassrls` attribute.
-- See the note in section 3 on FORCE ROW LEVEL SECURITY.

-- ===========================================================================
-- SECTION 1 of 3 — 001_schema.sql
-- Tables, types, constraints, relationships, indexes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto. It is used for the default primary
-- key values on projects and issues.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum: issue status
-- ---------------------------------------------------------------------------
-- The three lifecycle states of an issue. Mirrors STATUSES in
-- src/lib/constants.ts. A CREATE TYPE is not idempotent on its own, so the
-- guarded form below makes re-pasting this file harmless.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'issue_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.issue_status AS ENUM ('todo', 'in_progress', 'done');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table: profiles
-- ---------------------------------------------------------------------------
-- One row per user. Created by the signup trigger, not by the application.
--
--   id         : the user's own uuid; also the foreign key to auth.users.
--   email      : denormalized copy of auth.users.email, for display.
--   created_at : when the profile row was created.
--
-- ON DELETE CASCADE means deleting the auth user removes the profile.
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: projects
-- ---------------------------------------------------------------------------
-- A project owned by exactly one user.
--
--   owner_id  : the owning user. Every RLS policy on this table compares
--               owner_id to auth.uid(), so this column is the ownership
--               anchor for projects and for the issues inside them.
--   name      : display name. CHECK keeps it non-empty and bounded.
--
-- ON DELETE CASCADE means deleting the auth user removes their projects.
CREATE TABLE IF NOT EXISTS public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 100)
);

-- ---------------------------------------------------------------------------
-- Table: issues
-- ---------------------------------------------------------------------------
-- An issue belonging to exactly one project. Ownership is inherited from
-- the project, so issues carry no owner_id of their own.
--
--   project_id  : owning project. ON DELETE CASCADE means deleting a
--                 project deletes its issues.
--   title       : required, non-empty, bounded.
--   description : optional, bounded.
--   status      : issue_status enum, defaults to 'todo'.
--   priority    : smallint, 1 = low, 2 = medium, 3 = high, defaults to 2.
--
-- priority is a smallint rather than a text enum so that ordering by
-- priority is correct in every query with no CASE expression.
CREATE TABLE IF NOT EXISTS public.issues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  status      public.issue_status NOT NULL DEFAULT 'todo',
  priority    smallint NOT NULL DEFAULT 2,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issues_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT issues_description_length CHECK (
    description IS NULL OR char_length(description) <= 5000
  ),
  CONSTRAINT issues_priority_range CHECK (priority BETWEEN 1 AND 3)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Every RLS policy on issues filters through projects.owner_id, and every
-- project query filters on owner_id. These two indexes are what keep those
-- checks fast as the data grows.
CREATE INDEX IF NOT EXISTS projects_owner_id_idx
  ON public.projects (owner_id);

CREATE INDEX IF NOT EXISTS issues_project_id_idx
  ON public.issues (project_id);

-- Composite index for the dashboard query: the user's projects, then the
-- issues inside them.
CREATE INDEX IF NOT EXISTS issues_project_priority_idx
  ON public.issues (project_id, priority);


-- ===========================================================================
-- SECTION 2 of 3 — 002_triggers.sql
-- updated_at triggers, signup initialization, and the auth.users trigger
-- that wires signup to it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- WHY THESE FUNCTIONS STAY IN `public` RATHER THAN A `private` SCHEMA
-- ---------------------------------------------------------------------------
-- Supabase's guidance is to put `security definer` functions in a schema
-- that is NOT exposed through the Data API:
--   "Never create one in a schema listed under 'Exposed schemas' in your
--    API settings."
-- `public` IS exposed by default, so the recommendation would be a
-- `private` schema, plus `set search_path = ''` and schema-qualified
-- names inside.
--
-- The search_path part of that guidance is applied here: every function in
-- this file pins an EMPTY search_path and schema-qualifies every object it
-- references. See the security notes on each function.
--
-- The schema placement is deliberately NOT changed, because it would
-- require changing the planned function names:
--   * The implementation plan specifies `public.initialize_devdesk_user`
--     and `public.handle_new_user` by exact name, and that is the
--     contract the rest of the plan and the README refer to.
--   * Moving them to `private` renames both to
--     `private.initialize_devdesk_user` / `private.handle_new_user`,
--     which is a deviation from the approved design.
--
-- The trade-off, stated plainly:
--   * RISK OF STAYING IN public: the functions are visible in the Data API
--     surface. Supabase notes "A `security definer` function in an exposed
--     schema is callable over the Data API with the creator's
--     privileges."
--   * WHY THAT RISK IS ACCEPTED HERE: EXECUTE is revoked from PUBLIC, from
--     anon, and from authenticated on BOTH functions. A client role needs
--     BOTH schema USAGE and function EXECUTE to call a function, and it
--     has neither. The functions are therefore not callable over the Data
--     API at all. Schema placement would be defense in depth on top of a
--     control that is already closed.
--   * The functions still need to be reachable by the database's own
--     trigger machinery, which is unaffected by schema placement.
--
-- If the project later moves to a `private` schema, the change is
-- mechanical: rename the two functions, add `create schema if not exists
-- private;`, `revoke all on schema private from public;`, and update the
-- `execute function` target in the trigger. No policy or table changes
-- are involved.

-- ---------------------------------------------------------------------------
-- Function: public.set_updated_at()
-- ---------------------------------------------------------------------------
-- Keeps public.projects.updated_at and public.issues.updated_at current.
-- It is a plain trigger function, so it does not need SECURITY DEFINER and
-- does not need elevated privileges: it only writes columns of the row that
-- the caller is already allowed to update.
--
-- It still pins an empty search_path and qualifies the one function it
-- calls, so the same hardening applies to every function in this file.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

-- Drop and recreate so a re-paste does not fail on "trigger already exists".
DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS issues_set_updated_at ON public.issues;
CREATE TRIGGER issues_set_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Function: public.initialize_devdesk_user(p_user_id uuid)
-- ---------------------------------------------------------------------------
-- The signup work function. Creates the user's profile row and, only if the
-- profile row was genuinely created by this call, a default "Inbox" project.
--
-- Security notes:
--   * SECURITY DEFINER, because the calling session is the auth service
--     role and the rows must be created for the *new* user, not for the
--     session (there is no session on a signup trigger).
--   * SET search_path = '' -- an empty search path. This is the strictest
--     form of the control: no schema is searched implicitly, so an
--     attacker-created object (including a temp table, which is writable
--     by everyone and searched first by default) cannot shadow anything
--     referenced here. This is the pattern Supabase documents for every
--     security definer function.
--   * Because the search path is empty, EVERY database object referenced
--     in this body is schema-qualified: auth.users, public.profiles,
--     public.projects, and pg_catalog.now(). Built-in pg_catalog
--     functions are still resolvable through PostgreSQL's implicit
--     pg_catalog lookup, but they are qualified explicitly here so the
--     intent is unambiguous and so the function cannot be subverted by
--     anything the caller controls.
--   * The only argument is a user id. The email is read from auth.users
--     server-side; the function never trusts a caller-supplied email.
--   * EXECUTE is revoked from PUBLIC and from both client-facing roles
--     (anon, authenticated). Only the owning role may call it directly.
--     The signup trigger reaches it through public.handle_new_user(), which
--     is SECURITY DEFINER and therefore calls it with the owner's
--     privileges. See the Grants section below for the full reasoning.
--   * SECURITY DEFINER bypasses RLS, so this function is the single
--     privileged path in the schema. The trigger passes NEW.id, which is
--     the row's own id and not caller-supplied input.
--
-- Returns void so it can be called directly with a user id.
CREATE OR REPLACE FUNCTION public.initialize_devdesk_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_email text;
  v_profile_created boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'initialize_devdesk_user: p_user_id must not be null';
  END IF;

  -- Read the email from auth.users rather than accepting it as an argument.
  SELECT u.email INTO v_user_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  -- ON CONFLICT DO NOTHING makes a duplicate call harmless. The RETURNING
  -- clause only yields a row when the insert actually happened, which is
  -- how we detect "first time" versus "already initialized".
  INSERT INTO public.profiles (id, email)
  VALUES (p_user_id, v_user_email)
  ON CONFLICT (id) DO NOTHING
  RETURNING true INTO v_profile_created;

  -- Seed the default project ONLY on the very first initialization. If the
  -- user already deleted their Inbox project, this call does nothing, so
  -- the Inbox is never recreated. See the accepted limitation in the plan:
  -- the guarantee is "at most one seeded project per user", not exactly one.
  IF v_profile_created THEN
    INSERT INTO public.projects (owner_id, name)
    VALUES (p_user_id, 'Inbox');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Function: public.handle_new_user()
-- ---------------------------------------------------------------------------
-- The RETURNS trigger wrapper. Postgres requires a trigger function to
-- return trigger, so the work function above cannot be the trigger target
-- directly. This wrapper adapts NEW.id -> initialize_devdesk_user(uuid) and
-- keeps the trigger body to one line.
--
-- Same security posture as initialize_devdesk_user: SECURITY DEFINER,
-- empty search_path, schema-qualified call, no client-role grants.
--
-- This wrapper is the reason initialize_devdesk_user does not need an
-- EXECUTE grant for any client-facing role: while this SECURITY DEFINER
-- function runs it acts as the owner, and a call from a SECURITY DEFINER
-- function to another function is privilege-checked against the calling
-- function's effective identity.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.initialize_devdesk_user(NEW.id);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Default privileges on a SECURITY DEFINER function include EXECUTE for
-- PUBLIC. Revoke it, and grant it back only to the role that owns the
-- function.
--
-- Privilege model (why no client role is granted EXECUTE):
--
--   * initialize_devdesk_user(p_user_id uuid) accepts an arbitrary user id.
--     If the authenticated role could EXECUTE it, any logged-in user could
--     call it with someone else's id and create a profile and an Inbox
--     project for that other user. It must therefore NOT be callable by any
--     client-facing role.
--
--   * The signup trigger reaches it without any client grant. The trigger
--     function public.handle_new_user() is itself SECURITY DEFINER, so while
--     it runs it acts as the function owner. A call from a SECURITY DEFINER
--     function to another function is privilege-checked against the *calling
--     function's* effective identity, which here is the owner. The owner
--     always has EXECUTE on its own function, so the call succeeds.
--
--   * PostgreSQL checks EXECUTE on a trigger function when the trigger is
--     CREATED, not on every firing. The trigger is created in this file by
--     the owner, so it is created successfully and keeps working.
--
--   * The authenticated role needs no EXECUTE on either function. The
--     application never calls them; the trigger does.
REVOKE ALL ON FUNCTION public.initialize_devdesk_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- Explicitly remove EXECUTE from the client-facing roles. These are
-- idempotent: they are no-ops on a fresh database and correct the privilege
-- state if the file is re-pasted over a database that granted them earlier.
REVOKE ALL ON FUNCTION public.initialize_devdesk_user(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- The owner keeps EXECUTE implicitly (an owner always holds every privilege
-- on its own objects), so the trigger path works. This explicit grant to
-- the owner role makes the intent visible and is harmless.
GRANT EXECUTE ON FUNCTION public.initialize_devdesk_user(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres;

-- ---------------------------------------------------------------------------
-- Trigger: on_auth_user_created
-- ---------------------------------------------------------------------------
-- Fires after a row is inserted into auth.users, which is exactly the
-- moment a user signs up.
--
-- Duplicate-signup safety:
--   * The trigger fires once per auth.users INSERT. A second signup for the
--     same email creates a *different* auth.users row with a different id,
--     so it is a genuinely different user and gets its own profile and
--     Inbox. That is correct behavior, not a duplicate.
--   * If the same INSERT were ever replayed (retry, manual re-trigger), the
--     ON CONFLICT in initialize_devdesk_user means the profile insert is a
--     no-op and no second Inbox is created.
--
-- Failure behavior (transaction semantics):
--   * This is an AFTER trigger, so the auth.users row already exists on
--     disk when it fires. However, the trigger runs inside the same
--     transaction as the INSERT that fired it.
--   * If the trigger raises an unhandled exception, the exception aborts
--     the enclosing transaction. Everything the transaction did is rolled
--     back, including the auth.users INSERT that fired this trigger.
--   * The signup therefore fails atomically: either the user row, the
--     profile row, and the Inbox project are all committed, or none of them
--     are. There is no half-initialized state to repair.
--   * This function deliberately does NOT wrap its body in a PL/pgSQL
--     EXCEPTION block. Catching the error would let the transaction commit
--     a user row with no profile and no Inbox, which is the worse outcome.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ===========================================================================
-- SECTION 3 of 3 — 003_rls.sql
-- Row level security, policies, and table privileges.
-- ===========================================================================

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
--   * The signup trigger in section 2 is a SECURITY DEFINER function owned
--     by the same role as these tables. It relies on that bypass to write
--     the profile and the Inbox project, because auth.uid() is NULL during
--     a signup trigger and the policies would otherwise reject the insert.
--   * FORCE therefore has no effect on the trigger path, PROVIDED the
--     tables and the functions are owned by the same role that holds
--     bypassrls. Applying this migration as a different owner would put
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
-- The profile row is created by the signup trigger (section 2) and
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
