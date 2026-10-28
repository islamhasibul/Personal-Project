-- DevDesk — RLS tests for public.profiles, public.projects, public.issues
--
-- Framework: pgTAP.
-- Run with:  supabase test db
--           (or paste into the Supabase SQL editor as a single script)
--
-- ---------------------------------------------------------------------------
-- HOW THESE TESTS WORK, AND WHAT THEY PROVE
-- ---------------------------------------------------------------------------
-- These tests exercise the policies by switching the session role with
-- SET LOCAL ROLE. That is the only way to test RLS properly from SQL: the
-- SQL editor runs as the dashboard owner (postgres), which bypasses RLS
-- entirely, so a query issued as postgres proves nothing about isolation.
--
--   * SET LOCAL ROLE authenticated  -> statements run with the
--     authenticated role's privileges and are filtered by policies.
--   * SET LOCAL ROLE anon          -> statements run as the anonymous role.
--   * SET LOCAL ROLE postgres      -> restore the owner role.
--
-- SET LOCAL ROLE is scoped to the current transaction, so the role change
-- is undone automatically at COMMIT/ROLLBACK.
--
-- The test users are real rows in auth.users, created inside the
-- transaction and removed by the final ROLLBACK. auth.uid() reads the
-- request JWT's user id, which SET ROLE cannot change -- so these tests
-- set the JWT claims to impersonate a user:
--
--   request.jwt.claims = '{"sub":"<uuid>","role":"authenticated",...}'
--
-- and then SET LOCAL ROLE authenticated. The combination is what the
-- PostgREST data API does for a signed-in request.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON WHAT THIS FILE DOES AND DOES NOT VERIFY
-- ---------------------------------------------------------------------------
-- These tests have been WRITTEN and REVIEWED, but they have NOT been
-- EXECUTED. They require a live database with the three migrations
-- applied and the pgTAP extension available (supabase test db handles
-- that). No SQL has been run against Supabase as part of authoring them.
--
-- Until they have been run and reported as passing, RLS is NOT verified.
-- The plan's Phase 6 task 6.2 (two real accounts in the running app) is
-- still the authoritative isolation check, because it exercises the real
-- Data API path with real JWTs.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON THE ASSERTIONS USED HERE
-- ---------------------------------------------------------------------------
-- throws_ok(SQL, ERRCODE, ERRMSG, DESCRIPTION) asserts that the statement
-- raises an error with the given SQLSTATE. The expected SQLSTATE for a
-- Row Level Security violation is 42501 (insufficient_privilege).
--
-- The plan's section 5 says an unauthorized write may either fail with a
-- 42501 error OR affect zero rows, and that tests should accept either.
-- These tests use throws_ok, which asserts the strict form. If a given
-- statement turns out to affect zero rows instead of raising, the
-- corresponding assertion must be relaxed to an is() count check.
--
-- ---------------------------------------------------------------------------

begin;

select plan(40);

-- ---------------------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------------------

-- pgTAP lives in the extensions schema.
create extension if not exists pgtap with schema extensions;

-- Two test users in auth.users. They exist only for this transaction.
insert into auth.users (id, email, aud, role, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-a@example.test', 'authenticated', 'authenticated', crypt('x', gen_salt('bf')), now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'rls-b@example.test', 'authenticated', 'authenticated', crypt('x', gen_salt('bf')), now(), now());

-- Seed data as the owner (bypasses RLS, which is what we want for setup).
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'rls-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'rls-b@example.test');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Project B');

insert into public.issues (id, project_id, title, priority) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Issue A'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Issue B');

-- Impersonation helper: set the JWT claims for the given user id.
create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'email', 'rls-a@example.test',
      'aud', 'authenticated'
    )::text,
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- As user A, only A's profile is visible.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.profiles),
  1,
  'profiles: authenticated user sees exactly 1 own profile'
);
select is(
  (select id from public.profiles)::uuid,
  '11111111-1111-4111-8111-111111111111',
  'profiles: authenticated user sees their own profile row'
);
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  0,
  'profiles: authenticated user cannot see another user profile'
);
reset role;

-- anon sees no profiles at all.
set local role anon;
select is(
  (select count(*)::int from public.profiles),
  0,
  'profiles: anon sees 0 profiles'
);
reset role;

-- A user cannot insert a profile for someone else.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$ insert into public.profiles (id, email) values ('22222222-2222-4222-8222-222222222222', 'x@example.test') $$,
  '42501',
  null,
  'profiles: authenticated user cannot insert a profile for another user'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('33333333-3333-4333-8333-333333333333', 'y@example.test') $$,
  '42501',
  null,
  'profiles: authenticated user cannot insert a profile at all (trigger only)'
);
reset role;

-- A user cannot delete a profile (trigger only).
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$ delete from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  null,
  'profiles: authenticated user cannot delete a profile'
);
reset role;

-- A user cannot update another user's profile.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$ update public.profiles set email = 'hijacked@example.test' where id = '22222222-2222-4222-8222-222222222222' $$,
  '42501',
  null,
  'profiles: authenticated user cannot update another user profile'
);
select lives_ok(
  $$ update public.profiles set email = 'rls-a-new@example.test' where id = '11111111-1111-4111-8111-111111111111' $$,
  'profiles: authenticated user can update their own profile'
);
reset role;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.projects),
  1,
  'projects: authenticated user sees exactly 1 own project'
);
select is(
  (select name from public.projects),
  'Project A',
  'projects: authenticated user sees their own project'
);
select is(
  (select count(*)::int from public.projects where owner_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'projects: authenticated user cannot see another user project'
);
reset role;

set local role anon;
select is(
  (select count(*)::int from public.projects),
  0,
  'projects: anon sees 0 projects'
);
reset role;

-- Insert own project: allowed.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ insert into public.projects (id, owner_id, name) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'Own Project') $$,
  'projects: authenticated user can create a project they own'
);
-- Insert a project owned by someone else: denied by WITH CHECK.
select throws_ok(
  $$ insert into public.projects (id, owner_id, name) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '22222222-2222-4222-8222-222222222222', 'Stolen Project') $$,
  '42501',
  null,
  'projects: authenticated user cannot create a project owned by another user'
);
reset role;

-- Update own project: allowed. Update another user's: denied.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ update public.projects set name = 'Renamed A' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'projects: authenticated user can rename their own project'
);
select throws_ok(
  $$ update public.projects set name = 'Hijacked' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'projects: authenticated user cannot rename another user project'
);
-- Reassigning ownership to another user: denied by WITH CHECK.
select throws_ok(
  $$ update public.projects set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501',
  null,
  'projects: authenticated user cannot reassign their project to another user'
);
reset role;

-- Delete own project: allowed. Delete another user's: denied.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ delete from public.projects where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $$,
  'projects: authenticated user can delete their own project'
);
select throws_ok(
  $$ delete from public.projects where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'projects: authenticated user cannot delete another user project'
);
reset role;

-- anon cannot insert or delete.
set local role anon;
select throws_ok(
  $$ insert into public.projects (owner_id, name) values ('22222222-2222-4222-8222-222222222222', 'Anon Project') $$,
  '42501',
  null,
  'projects: anon cannot insert a project'
);
select throws_ok(
  $$ delete from public.projects where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501',
  null,
  'projects: anon cannot delete a project'
);
reset role;

-- ---------------------------------------------------------------------------
-- issues
-- ---------------------------------------------------------------------------

select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.issues),
  1,
  'issues: authenticated user sees exactly 1 own issue'
);
select is(
  (select title from public.issues),
  'Issue A',
  'issues: authenticated user sees their own issue'
);
select is(
  (select count(*)::int from public.issues where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'issues: authenticated user cannot see an issue in another user project'
);
reset role;

set local role anon;
select is(
  (select count(*)::int from public.issues),
  0,
  'issues: anon sees 0 issues'
);
reset role;

-- Insert into own project: allowed. Into another user's project: denied.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ insert into public.issues (id, project_id, title) values ('12121212-1212-4212-8212-121212121212', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Own Issue') $$,
  'issues: authenticated user can create an issue in their own project'
);
select throws_ok(
  $$ insert into public.issues (id, project_id, title) values ('13131313-1313-4313-8313-131313131313', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Stolen Issue') $$,
  '42501',
  null,
  'issues: authenticated user cannot create an issue in another user project'
);
reset role;

-- Update own issue: allowed. Repoint to another user's project: denied.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ update public.issues set title = 'Renamed Issue A' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  'issues: authenticated user can edit an issue in their own project'
);
select throws_ok(
  $$ update public.issues set project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501',
  null,
  'issues: authenticated user cannot repoint their issue at another user project'
);
select throws_ok(
  $$ update public.issues set title = 'Hijacked' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' $$,
  '42501',
  null,
  'issues: authenticated user cannot edit an issue in another user project'
);
reset role;

-- Delete own issue: allowed. Delete another user's: denied.
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$ delete from public.issues where id = '12121212-1212-4212-8212-121212121212' $$,
  'issues: authenticated user can delete an issue in their own project'
);
select throws_ok(
  $$ delete from public.issues where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' $$,
  '42501',
  null,
  'issues: authenticated user cannot delete an issue in another user project'
);
reset role;

-- anon cannot write issues.
set local role anon;
select throws_ok(
  $$ insert into public.issues (project_id, title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anon Issue') $$,
  '42501',
  null,
  'issues: anon cannot insert an issue'
);
select throws_ok(
  $$ delete from public.issues where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501',
  null,
  'issues: anon cannot delete an issue'
);
reset role;

-- ---------------------------------------------------------------------------
-- Cross-user check: after all of the above, no data leaked.
-- ---------------------------------------------------------------------------
select as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.issues where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'issues: still no access to another user issues after all operations'
);
select is(
  (select count(*)::int from public.projects where owner_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'projects: still no access to another user projects after all operations'
);
reset role;

-- ---------------------------------------------------------------------------
-- Ownership is unchanged: user B still owns exactly their own data.
-- ---------------------------------------------------------------------------
set local role postgres;
select is(
  (select count(*)::int from public.projects where owner_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'projects: denied operations did not modify user B project ownership'
);
select is(
  (select count(*)::int from public.issues i join public.projects p on p.id = i.project_id where p.owner_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'issues: denied operations did not modify user B issues'
);
select is(
  (select count(*)::int from public.profiles),
  2,
  'profiles: denied operations did not create extra profile rows'
);
reset role;

select * from finish();

rollback;
