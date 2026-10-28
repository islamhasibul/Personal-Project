-- DevDesk — 001_schema.sql
-- Phase 2, task 2.1: tables, types, constraints, relationships, indexes.
--
-- Apply order: 001 -> 002 -> 003.
-- This file is idempotent: it can be re-pasted safely after a partial failure.
--
-- Scope note: this file creates the `issue_status` enum and the three
-- user-data tables. It contains no triggers (see 002_triggers.sql) and no
-- row-level security (see 003_rls.sql).

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
