-- DevDesk — signup trigger and schema integrity tests
--
-- Framework: pgTAP.
-- Run with:  supabase test db
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE COVERS
-- ---------------------------------------------------------------------------
--   1. Schema integrity: tables, columns, types, defaults, CHECK
--      constraints, foreign keys, and indexes exist as specified.
--   2. RLS is enabled on all three tables.
--   3. The signup trigger creates a profile and exactly one Inbox project.
--   4. The signup trigger is idempotent for the same user id.
--   5. The Inbox project is NOT recreated after the user deletes it.
--   6. A failed signup leaves no partial state behind.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON THE pgTAP FUNCTIONS USED HERE
-- ---------------------------------------------------------------------------
-- This file deliberately sticks to pgTAP assertions whose signatures are
-- stable and documented: has_table, has_column, col_type_is,
-- col_default_is, has_check, has_fk, has_index, has_function, is, ok,
-- throws_ok, lives_ok, plan, finish.
--
-- pgTAP has no has_trigger or has_function_privilege assertion, so the
-- trigger existence and the EXECUTE privilege checks below are written as
-- plain SQL wrapped in ok(). That is equivalent and has no dependency on
-- an assertion that may not exist in the installed pgTAP version.
--
-- ---------------------------------------------------------------------------
-- STATUS: WRITTEN AND REVIEWED, NOT EXECUTED.
-- These tests need a live database with the three migrations applied.
-- No SQL has been run against Supabase while authoring this file.
-- ---------------------------------------------------------------------------

begin;

select plan(49);

create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Schema integrity
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'issues', 'issues table exists');

select has_column('public', 'profiles', 'id', 'profiles.id exists');
select has_column('public', 'profiles', 'email', 'profiles.email exists');
select has_column('public', 'profiles', 'created_at', 'profiles.created_at exists');

select has_column('public', 'projects', 'id', 'projects.id exists');
select has_column('public', 'projects', 'owner_id', 'projects.owner_id exists');
select has_column('public', 'projects', 'name', 'projects.name exists');
select has_column('public', 'projects', 'created_at', 'projects.created_at exists');
select has_column('public', 'projects', 'updated_at', 'projects.updated_at exists');

select has_column('public', 'issues', 'id', 'issues.id exists');
select has_column('public', 'issues', 'project_id', 'issues.project_id exists');
select has_column('public', 'issues', 'title', 'issues.title exists');
select has_column('public', 'issues', 'description', 'issues.description exists');
select has_column('public', 'issues', 'status', 'issues.status exists');
select has_column('public', 'issues', 'priority', 'issues.priority exists');
select has_column('public', 'issues', 'created_at', 'issues.created_at exists');
select has_column('public', 'issues', 'updated_at', 'issues.updated_at exists');

-- priority must be a smallint with default 2 (1 = low, 2 = medium, 3 = high).
select col_type_is(
  'public', 'issues', 'priority', 'smallint',
  'issues.priority is smallint'
);
select col_default_is(
  'public', 'issues', 'priority', '2',
  'issues.priority defaults to 2 (medium)'
);

-- CHECK constraints exist (has_check takes schema, table, description).
select has_check('public', 'issues', 'issues has a check constraint');
select has_check('public', 'projects', 'projects has a check constraint');

-- Foreign keys exist (has_fk takes schema, table, description).
select has_fk('public', 'projects', 'projects has a foreign key');
select has_fk('public', 'issues', 'issues has a foreign key');

-- Indexes.
select has_index('public', 'projects', 'projects_owner_id_idx', 'projects owner_id index exists');
select has_index('public', 'issues', 'issues_project_id_idx', 'issues project_id index exists');

-- The priority check actually rejects out-of-range values.
select throws_ok(
  $$ insert into public.issues (project_id, title, priority)
     values (gen_random_uuid(), 'bad priority', 9) $$,
  null,
  null,
  'issues.priority CHECK rejects a value outside 1..3'
);

-- ---------------------------------------------------------------------------
-- 2. RLS is enabled on all three tables
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on public.profiles'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  'RLS is enabled on public.projects'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.issues'::regclass),
  'RLS is enabled on public.issues'
);

-- ---------------------------------------------------------------------------
-- 3. Function security posture
-- ---------------------------------------------------------------------------

select has_function('public', 'initialize_devdesk_user', ARRAY['uuid'], 'initialize_devdesk_user(uuid) exists');
select has_function('public', 'handle_new_user', ARRAY[]::text[], 'handle_new_user() exists');

-- Both SECURITY DEFINER functions must pin an EMPTY search_path.
select ok(
  (select proconfig::text like '%search_path=%""%'
     from pg_proc
    where proname = 'initialize_devdesk_user'
      and pronamespace = 'public'::regnamespace),
  'initialize_devdesk_user pins an empty search_path'
);
select ok(
  (select proconfig::text like '%search_path=%""%'
     from pg_proc
    where proname = 'handle_new_user'
      and pronamespace = 'public'::regnamespace),
  'handle_new_user pins an empty search_path'
);

-- Neither function may be executable by anon or authenticated.
select ok(
  not has_function_privilege('anon', 'public.initialize_devdesk_user(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE initialize_devdesk_user'
);
select ok(
  not has_function_privilege('authenticated', 'public.initialize_devdesk_user(uuid)', 'EXECUTE'),
  'authenticated cannot EXECUTE initialize_devdesk_user'
);
select ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
  'anon cannot EXECUTE handle_new_user'
);
select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'authenticated cannot EXECUTE handle_new_user'
);

-- The signup trigger exists on auth.users.
select ok(
  exists (
    select 1
      from pg_trigger
     where tgname = 'on_auth_user_created'
       and tgrelid = 'auth.users'::regclass
  ),
  'signup trigger on_auth_user_created exists on auth.users'
);

-- ---------------------------------------------------------------------------
-- 4. The signup trigger creates a profile and one Inbox project
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, encrypted_password, created_at, updated_at)
values (
  '44444444-4444-4444-8444-444444444444',
  'signup-a@example.test',
  'authenticated',
  'authenticated',
  crypt('x', gen_salt('bf')),
  now(),
  now()
);

select is(
  (select count(*)::int from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  1,
  'signup trigger created the profile row'
);
select is(
  (select email from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  'signup-a@example.test',
  'signup trigger copied the email from auth.users'
);
select is(
  (select count(*)::int from public.projects where owner_id = '44444444-4444-4444-8444-444444444444' and name = 'Inbox'),
  1,
  'signup trigger created exactly one Inbox project'
);

-- ---------------------------------------------------------------------------
-- 5. The trigger is idempotent: re-running the helper adds nothing
-- ---------------------------------------------------------------------------

select public.initialize_devdesk_user('44444444-4444-4444-8444-444444444444');

select is(
  (select count(*)::int from public.profiles where id = '44444444-4444-4444-8444-444444444444'),
  1,
  're-initializing does not duplicate the profile'
);
select is(
  (select count(*)::int from public.projects where owner_id = '44444444-4444-4444-8444-444444444444' and name = 'Inbox'),
  1,
  're-initializing does not create a second Inbox project'
);

-- ---------------------------------------------------------------------------
-- 6. The Inbox is NOT recreated after the user deletes it
-- ---------------------------------------------------------------------------

delete from public.projects where owner_id = '44444444-4444-4444-8444-444444444444' and name = 'Inbox';

select is(
  (select count(*)::int from public.projects where owner_id = '44444444-4444-4444-8444-444444444444'),
  0,
  'Inbox project was deleted'
);

select public.initialize_devdesk_user('44444444-4444-4444-8444-444444444444');

select is(
  (select count(*)::int from public.projects where owner_id = '44444444-4444-4444-8444-444444444444'),
  0,
  'the deleted Inbox project is NOT recreated on re-initialization'
);

-- ---------------------------------------------------------------------------
-- 7. A failed initialization leaves no partial state behind
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.initialize_devdesk_user(null) $$,
  null,
  null,
  'initialize_devdesk_user rejects a NULL user id'
);

select is(
  (select count(*)::int from public.profiles where id is null),
  0,
  'a failed initialization created no profile row'
);

-- ---------------------------------------------------------------------------
-- Teardown
-- ---------------------------------------------------------------------------

select * from finish();

rollback;
