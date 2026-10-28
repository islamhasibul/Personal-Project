-- DevDesk — 002_triggers.sql
-- Phase 2, task 2.2: updated_at triggers, signup initialization, and the
-- auth.users trigger that wires signup to it.
--
-- Apply order: 001 -> 002 -> 003.
-- This file is idempotent: it can be re-pasted safely after a partial failure.
--
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
