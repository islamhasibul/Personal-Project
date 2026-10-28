/**
 * Local, offline sanity check for the DevDesk migration files.
 *
 * This does NOT connect to Supabase and does NOT modify any database.
 * It reads the three SQL files as text and checks structural invariants
 * that a human reviewer would otherwise have to verify by eye:
 *
 *   1. balanced dollar-quoting ($$ ... $$) and statement terminators
 *   2. balanced parentheses
 *   3. every named object in the plan exists in the right file
 *   4. every UPDATE policy has BOTH USING and WITH CHECK
 *   5. every policy that references a table uses auth.uid()
 *   6. no policy is granted TO anon
 *   7. SECURITY DEFINER functions pin an EMPTY search_path and are
 *      schema-qualified
 *   8. the exact spelling "devdesk" is used in function names
 *   9. no client-facing role holds EXECUTE on the signup functions
 *  10. the signup-failure comments describe the real rollback semantics
 *  11. the database tests exist and their plan() matches the assertions
 *
 * Run with: node scripts/check-migrations.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const testsDir = join(root, "supabase", "tests", "database");

const files = {
  "001": "001_schema.sql",
  "002": "002_triggers.sql",
  "003": "003_rls.sql",
};

const failures = [];

function fail(file, msg) {
  failures.push(`${file}: ${msg}`);
}

// --- load -------------------------------------------------------------------
const sql = {};
for (const [key, name] of Object.entries(files)) {
  const path = join(migrationsDir, name);
  if (!existsSync(path)) {
    failures.push(`${name}: file is missing`);
    continue;
  }
  sql[key] = readFileSync(path, "utf8");
}
if (Object.keys(sql).length < 3) {
  console.error("FATAL: missing migration files; aborting.");
  process.exit(1);
}

// --- 1. dollar-quoting ------------------------------------------------------
// Count $$ occurrences; they must be even, and no single $ tag may be
// reused as an opener after its closer.
for (const [key, text] of Object.entries(sql)) {
  const tags = text.match(/\$\$/g) || [];
  if (tags.length % 2 !== 0) {
    fail(files[key], `unbalanced dollar-quoting: found ${tags.length} occurrences of $$ (must be even)`);
  }
  // Detect a named tag like $func$ that is opened but never closed.
  const named = [...text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g)].map((m) => m[1]);
  for (const tag of new Set(named)) {
    const count = (text.match(new RegExp(`\\$${tag}\\$`, "g")) || []).length;
    if (count % 2 !== 0) {
      fail(files[key], `unbalanced dollar-quote tag $${tag}$ (${count} occurrences)`);
    }
  }
}

// --- 2. parentheses ----------------------------------------------------------
// Strip string literals and dollar-quoted bodies before counting.
for (const [key, text] of Object.entries(sql)) {
  const stripped = text
    .replace(/\$\$.*?\$\$/gs, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, "");
  const open = (stripped.match(/\(/g) || []).length;
  const close = (stripped.match(/\)/g) || []).length;
  if (open !== close) {
    fail(files[key], `unbalanced parentheses: ${open} '(' vs ${close} ')'`);
  }
}

// --- 3. required objects -----------------------------------------------------
const required = [
  ["001", /CREATE TABLE IF NOT EXISTS public\.profiles/i, "table public.profiles"],
  ["001", /CREATE TABLE IF NOT EXISTS public\.projects/i, "table public.projects"],
  ["001", /CREATE TABLE IF NOT EXISTS public\.issues/i, "table public.issues"],
  ["001", /CREATE TYPE public\.issue_status AS ENUM/i, "enum public.issue_status"],
  ["001", /priority\s+smallint\s+NOT NULL\s+DEFAULT 2/i, "priority smallint NOT NULL DEFAULT 2"],
  ["001", /CHECK\s*\(\s*priority BETWEEN 1 AND 3\s*\)/i, "priority CHECK between 1 and 3"],
  ["001", /ON DELETE CASCADE/i, "FK ON DELETE CASCADE"],
  ["001", /projects_owner_id_idx/i, "index on projects(owner_id)"],
  ["001", /issues_project_id_idx/i, "index on issues(project_id)"],
  ["001", /CREATE EXTENSION IF NOT EXISTS pgcrypto/i, "pgcrypto extension"],

  ["002", /CREATE OR REPLACE FUNCTION public\.initialize_devdesk_user\s*\(\s*p_user_id uuid\s*\)/i, "function public.initialize_devdesk_user(uuid)"],
  ["002", /CREATE OR REPLACE FUNCTION public\.handle_new_user\s*\(\s*\)/i, "function public.handle_new_user()"],
  ["002", /RETURNS\s+trigger/i, "handle_new_user RETURNS trigger"],
  ["002", /RETURNS\s+void/i, "initialize_devdesk_user RETURNS void"],
  ["002", /PERFORM public\.initialize_devdesk_user\(NEW\.id\)/i, "wrapper calls initialize_devdesk_user(NEW.id)"],
  ["002", /CREATE TRIGGER on_auth_user_created[\s\S]*?AFTER INSERT ON auth\.users[\s\S]*?EXECUTE FUNCTION public\.handle_new_user\(\)/i, "trigger on_auth_user_created"],
  ["002", /SECURITY DEFINER/i, "SECURITY DEFINER"],
  ["002", /SET search_path = ''/i, "pinned empty search_path"],

  ["003", /ALTER TABLE public\.profiles ENABLE ROW LEVEL SECURITY/i, "RLS on profiles"],
  ["003", /ALTER TABLE public\.projects ENABLE ROW LEVEL SECURITY/i, "RLS on projects"],
  ["003", /ALTER TABLE public\.issues\s+ENABLE ROW LEVEL SECURITY/i, "RLS on issues"],
];

for (const [key, pattern, label] of required) {
  if (!pattern.test(sql[key])) {
    fail(files[key], `missing ${label}`);
  }
}

// --- 3b. exact spelling of "devdesk" in function names ------------------------
for (const [key, text] of Object.entries(sql)) {
  for (const m of text.matchAll(/initialize_\w+/g)) {
    if (m[0] !== "initialize_devdesk_user") {
      fail(files[key], `function name "${m[0]}" must be spelled "initialize_devdesk_user"`);
    }
  }
}

// --- 4/5/6. policy checks ----------------------------------------------------
// Extract each CREATE POLICY block.
const policyRe = /CREATE POLICY\s+(\w+)\s+ON\s+public\.(\w+)[\s\S]*?;/gi;
for (const [key, text] of Object.entries(sql)) {
  for (const m of text.matchAll(policyRe)) {
    const [, name, table] = m;
    const body = m[0];

    // Every policy must use auth.uid().
    if (!/auth\.uid\(\)/.test(body)) {
      fail(files[key], `policy ${name} on ${table} does not use auth.uid()`);
    }
    // No policy may be granted to anon.
    if (/TO\s+(?:PUBLIC\s*,\s*)?anon/i.test(body)) {
      fail(files[key], `policy ${name} on ${table} is granted TO anon`);
    }
    // Every UPDATE policy needs BOTH USING and WITH CHECK.
    if (/FOR\s+UPDATE/i.test(body)) {
      if (!/USING\s*\(/i.test(body)) {
        fail(files[key], `UPDATE policy ${name} on ${table} is missing USING`);
      }
      if (!/WITH\s+CHECK\s*\(/i.test(body)) {
        fail(files[key], `UPDATE policy ${name} on ${table} is missing WITH CHECK`);
      }
    }
  }
}

// --- 7. SECURITY DEFINER hygiene ---------------------------------------------
for (const [key, text] of Object.entries(sql)) {
  const fnRe = /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/gi;
  for (const m of text.matchAll(fnRe)) {
    const [, fname, body] = m;
    const header = m[0].slice(0, m[0].indexOf("AS $$"));
    if (!/SECURITY DEFINER/i.test(header)) continue;
    if (!/SET search_path\s*=\s*''/i.test(header)) {
      fail(files[key], `SECURITY DEFINER function ${fname} does not pin an empty search_path`);
    }
    // Any table reference inside the body must be schema-qualified.
    for (const t of body.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      if (t[1] !== "public" && t[1] !== "auth") {
        fail(files[key], `function ${fname} references unqualified schema ${t[1]}`);
      }
    }
  }
}

// --- 7b. with an empty search_path, EVERY reference must be qualified -------
// A function with search_path = '' resolves nothing implicitly, so an
// unqualified table or function name inside it fails at runtime. Catch
// that at review time instead.
for (const [key, text] of Object.entries(sql)) {
  const fnRe = /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/gi;
  for (const m of text.matchAll(fnRe)) {
    const [, fname, body] = m;
    const header = m[0].slice(0, m[0].indexOf("AS $$"));
    if (!/SET search_path\s*=\s*''/i.test(header)) continue;

    // Table references must be schema-qualified: catch FROM x / INTO x
    // where x has no schema prefix. "INTO" is excluded here because
    // "INTO var" is a PL/pgSQL assignment target, not a table.
    // The name may be followed by an alias, "(", ",", ";" or end of line.
    for (const t of body.matchAll(
      /\b(?:FROM|UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_.])(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*(?:\(|,|;|$|\n)/gi,
    )) {
      fail(
        files[key],
        `function ${fname} has an unqualified table reference "${t[1]}" but pins an empty search_path`,
      );
    }
    // Function calls must be schema-qualified. Only names that are clearly
    // function calls are considered; SQL keywords that happen to be
    // followed by "(" (VALUES, CONFLICT, INTO, RETURNING, ...) are not.
    const sqlKeywords = new Set([
      "values", "conflict", "into", "returning", "on", "and", "or", "not",
      "in", "is", "null", "case", "when", "then", "else", "end", "select",
      "insert", "update", "delete", "from", "where", "set", "perform",
      "raise", "exception", "if", "elsif", "loop", "begin", "declare",
    ]);
    // Built-ins that are allowed to stay unqualified because pg_catalog is
    // always implicitly searched. Anything else must be schema-qualified.
    const builtinOk = new Set([
      "coalesce", "nullif", "greatest", "least",
      "count", "sum", "avg", "min", "max",
      "json_build_object", "set_config", "format",
    ]);
    for (const c of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const name = c[1];
      if (sqlKeywords.has(name.toLowerCase())) continue;
      if (builtinOk.has(name.toLowerCase())) continue;
      // A schema-qualified call is fine.
      const before = body.slice(0, c.index);
      if (/[A-Za-z0-9_]\.\s*$/.test(before)) continue;
      fail(
        files[key],
        `function ${fname} calls "${name}(...)" without a schema prefix; with an empty search_path it must be pg_catalog-qualified`,
      );
    }
  }
}

// --- 8. cross-file conflicts -------------------------------------------------
// A DROP IF EXISTS should precede every CREATE for triggers and policies so
// re-pasting is harmless.
for (const [key, text] of Object.entries(sql)) {
  const creates = [...text.matchAll(/CREATE\s+(?:POLICY|TRIGGER)\s+/gi)].length;
  const drops = [...text.matchAll(/DROP\s+(?:POLICY|TRIGGER)\s+IF EXISTS/gi)].length;
  if (creates !== drops) {
    fail(
      files[key],
      `idempotency mismatch: ${creates} CREATE POLICY/TRIGGER vs ${drops} DROP ... IF EXISTS`,
    );
  }
}

// --- cross-file: 003 must not enable RLS on a table 001 does not create -------
for (const tbl of ["profiles", "projects", "issues"]) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`, "i").test(sql["001"])) {
    fail(files["003"], `RLS enabled on public.${tbl} but 001_schema.sql does not create it`);
  }
}

// --- cross-file: 002 must not reference a table 001 does not create ----------
for (const tbl of ["profiles", "projects", "issues"]) {
  if (new RegExp(`public\\.${tbl}`, "i").test(sql["002"])) {
    if (!new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`, "i").test(sql["001"])) {
      fail(files["002"], `references public.${tbl} which 001_schema.sql does not create`);
    }
  }
}

// --- informational notes -----------------------------------------------------
if (/SECURITY DEFINER/i.test(sql["002"]) && !/REVOKE ALL ON FUNCTION public\.initialize_devdesk_user\(uuid\) FROM PUBLIC/i.test(sql["002"])) {
  fail(files["002"], "initialize_devdesk_user does not revoke EXECUTE from PUBLIC");
}
if (!/REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC/i.test(sql["002"])) {
  fail(files["002"], "handle_new_user does not revoke EXECUTE from PUBLIC");
}

// --- 9. client-role EXECUTE grants must NOT exist ----------------------------
// initialize_devdesk_user accepts an arbitrary user id. If a client-facing
// role (anon or authenticated) could EXECUTE it, a logged-in user could
// create a profile and an Inbox project for a different user. The trigger
// path works without these grants because handle_new_user is itself
// SECURITY DEFINER and calls it with the owner's privileges.
for (const fn of ["initialize_devdesk_user\\(uuid\\)", "handle_new_user\\(\\)"]) {
  const grantRe = new RegExp(
    `GRANT[^;]*\\bEXECUTE\\b[^;]*\\bON\\s+FUNCTION\\s+public\\.${fn}[^;]*\\bTO\\s+([^;]+);`,
    "gi",
  );
  for (const m of sql["002"].matchAll(grantRe)) {
    const roles = m[1]
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    for (const role of roles) {
      if (role === "anon" || role === "authenticated" || role === "public") {
        fail(
          files["002"],
          `GRANT EXECUTE to client-facing role "${role}" on ${fn} -- an authenticated caller could initialize another user's profile and Inbox`,
        );
      }
    }
  }
  // Both functions must explicitly revoke EXECUTE from the client roles.
  if (
    !new RegExp(
      `REVOKE[^;]*\\bON\\s+FUNCTION\\s+public\\.${fn}[^;]*\\bFROM\\s+[^;]*\\banon\\b[^;]*\\bauthenticated\\b`,
      "i",
    ).test(sql["002"])
  ) {
    fail(files["002"], `${fn} does not explicitly REVOKE EXECUTE from anon and authenticated`);
  }
}

// --- 10. signup failure semantics must be described correctly ---------------
// An unhandled exception in an AFTER trigger aborts the enclosing
// transaction, rolling back the auth.users INSERT too. The comments must
// not claim the profile row survives a failed signup.
//
// Normalize the comment text: drop the leading "-- " marker on each comment
// line (keeping the prose) and collapse whitespace, so a phrase split across
// comment lines ("rolled" / "back,") is still matched as one string.
const triggersFlat = sql["002"]
  .replace(/^\s*--\s?/gm, "")
  .replace(/\s+/g, " ");

if (/left in place|would be left|are left in place|survive|survives/i.test(triggersFlat)) {
  fail(files["002"], "comment claims a failed signup leaves rows behind; an unhandled trigger exception rolls back the whole transaction");
}
if (!/rolls? back|rolled back/i.test(triggersFlat)) {
  fail(files["002"], "no explanation of the rollback semantics of a failing signup trigger");
}

// --- 11. anon must never receive table or policy privileges ------------------
for (const [key, text] of Object.entries(sql)) {
  for (const m of text.matchAll(/GRANT[^;]*\bON\s+(?:TABLE|FUNCTION)?\s*public\.\w+[^;]*\bTO\s+([^;]*\banon\b[^;]*);/gi)) {
    fail(files[key], `GRANT to anon: ${m[0].trim()}`);
  }
}
// Every table must be revoked from anon.
for (const tbl of ["profiles", "projects", "issues"]) {
  if (!new RegExp(`REVOKE ALL ON public\\.${tbl}\\s+FROM anon`, "i").test(sql["003"])) {
    fail(files["003"], `public.${tbl} is not explicitly revoked from anon`);
  }
}

// --- 12. authenticated must have the table privileges the policies need ------
for (const tbl of ["profiles", "projects", "issues"]) {
  const re = new RegExp(`GRANT[^;]*\\bON\\s+public\\.${tbl}\\s+TO authenticated`, "i");
  if (!re.test(sql["003"])) {
    fail(files["003"], `public.${tbl} does not grant table privileges to authenticated`);
  }
}

// --- 13. FORCE ROW LEVEL SECURITY must be present and explained -------------
for (const tbl of ["profiles", "projects", "issues"]) {
  if (!new RegExp(`ALTER TABLE public\\.${tbl}\\s+FORCE ROW LEVEL SECURITY`, "i").test(sql["003"])) {
    fail(files["003"], `public.${tbl} does not have FORCE ROW LEVEL SECURITY`);
  }
}
if (!/bypassrls/i.test(sql["003"])) {
  fail(files["003"], "FORCE ROW LEVEL SECURITY is not documented with respect to the BYPASSRLS attribute");
}
// FORCE must not be claimed to override BYPASSRLS. Look for an affirmative
// claim, allowing for a negation immediately before it ("does NOT override").
const rlsFlat = sql["003"].replace(/^\s*--\s?/gm, "").replace(/\s+/g, " ");
const overrideClaims = [
  ...rlsFlat.matchAll(/(.{0,40})\bforce\b(.{0,60}?)\boverrides?\b(.{0,40}?)\bbypassrls\b/gi),
];
for (const m of overrideClaims) {
  const lead = m[1] || "";
  const mid = m[2] || "";
  // A negated form ("does not override", "does NOT override") is correct.
  if (/\b(?:not|never|no)\b/i.test(lead) || /\b(?:not|never|no)\b/i.test(mid)) continue;
  fail(files["003"], "comment claims FORCE overrides BYPASSRLS; it does not");
}
// The file must state the limitation explicitly.
if (!/always bypass|still bypass|bypass the policies/i.test(rlsFlat)) {
  fail(files["003"], "does not state that a role holding BYPASSRLS still bypasses the policies under FORCE");
}

// --- 14. database tests ------------------------------------------------------
if (!existsSync(testsDir)) {
  fail("supabase/tests/database", "test directory does not exist");
} else {
  const testFiles = readdirSync(testsDir).filter((f) => f.endsWith(".sql"));
  if (testFiles.length === 0) {
    fail("supabase/tests/database", "no .sql test files found");
  }

  // Every test file must declare a plan that matches its actual assertions.
  const assertionRe = /^select\s+(?:is|ok|throws_ok|lives_ok|has_table|has_column|has_check|has_fk|has_index|has_function|col_type_is|col_default_is)\s*\(/gim;

  for (const name of testFiles) {
    const path = join(testsDir, name);
    const text = readFileSync(path, "utf8");

    // pgTAP assertions must be wrapped in a transaction and rolled back.
    if (!/^\s*begin\s*;/im.test(text)) {
      fail(`supabase/tests/database/${name}`, "does not start a transaction with BEGIN");
    }
    if (!/rollback\s*;/i.test(text)) {
      fail(`supabase/tests/database/${name}`, "does not end with ROLLBACK");
    }
    if (!/select\s+\*\s+from\s+finish\(\)/i.test(text)) {
      fail(`supabase/tests/database/${name}`, "does not call finish()");
    }

    // plan(N) must equal the number of assertions.
    const planMatch = text.match(/select\s+plan\s*\(\s*(\d+)\s*\)/i);
    if (!planMatch) {
      fail(`supabase/tests/database/${name}`, "has no select plan(N) call");
    } else {
      const actual = (text.match(assertionRe) || []).length;
      const planned = Number(planMatch[1]);
      if (actual !== planned) {
        fail(
          `supabase/tests/database/${name}`,
          `plan(${planned}) does not match the ${actual} assertion(s) in the file`,
        );
      }
    }

    // Unwritten tests must be labelled clearly as not executed.
    // Normalize comment markers and whitespace so a phrase split across
    // lines is still matched as one string. The label must be an explicit
    // statement, so a bare mention of "EXECUTED" in another context does
    // not satisfy it.
    const testFlat = text.replace(/^\s*--\s?/gm, " ").replace(/\s+/g, " ");
    const notExecuted = /not\s+been\s+executed|not\s+executed|written\s+and\s+reviewed,?\s+not\s+executed/i.test(testFlat);
    const claimsExecuted = /(?:have\s+|has\s+|was\s+|were\s+)?been\s+executed\s+against\s+the\s+live\s+database/i.test(testFlat);
    if (!notExecuted || claimsExecuted) {
      fail(
        `supabase/tests/database/${name}`,
        "does not clearly state that the tests have NOT been executed against a live database",
      );
    }
  }

  // The three tables must all be covered by a test file.
  const allTests = testFiles
    .map((n) => readFileSync(join(testsDir, n), "utf8"))
    .join("\n");
  for (const tbl of ["profiles", "projects", "issues"]) {
    if (!new RegExp(`public\\.${tbl}`, "i").test(allTests)) {
      fail("supabase/tests/database", `no test file covers public.${tbl}`);
    }
  }
  // Both the allowed and the denied direction must be covered.
  if (!/lives_ok/i.test(allTests)) {
    fail("supabase/tests/database", "no test asserts an ALLOWED operation (lives_ok)");
  }
  if (!/throws_ok/i.test(allTests)) {
    fail("supabase/tests/database", "no test asserts a DENIED operation (throws_ok)");
  }
  // The anon role must be covered.
  if (!/set\s+local\s+role\s+anon/i.test(allTests)) {
    fail("supabase/tests/database", "no test covers the anon role");
  }
  // The authenticated role must be covered.
  if (!/set\s+local\s+role\s+authenticated/i.test(allTests)) {
    fail("supabase/tests/database", "no test covers the authenticated role");
  }
}

// --- report ------------------------------------------------------------------
const line = "─".repeat(72);
console.log(line);
console.log("DevDesk migration check (offline, read-only)");
console.log(line);
for (const [key, name] of Object.entries(files)) {
  const bytes = sql[key] ? Buffer.byteLength(sql[key]) : 0;
  const lines = sql[key] ? sql[key].split("\n").length : 0;
  console.log(`  ${name}  ${lines} lines, ${bytes} bytes`);
}
console.log(line);

if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.log(`  x ${f}`);
  console.log("\nResult: FAIL");
  process.exit(1);
}

console.log("\nAll checks passed.");
console.log("Result: PASS");
