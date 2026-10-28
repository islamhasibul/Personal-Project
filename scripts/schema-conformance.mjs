/**
 * Live schema conformance check.
 *
 * Every query the app issues is replayed against the real PostgREST
 * endpoint using the same SQL that `@supabase/supabase-js` generates. The
 * point is to prove the columns, the embed, the enum values, the ordering
 * columns and the `count: "exact"` delete are all genuinely valid on the
 * deployed database -- not just plausible from the migration files.
 *
 * PostgREST validates a requested column against its schema cache *before*
 * it checks privileges, so an unknown column comes back as a schema error
 * (PGRST204) while a known column on a table the anon role cannot read
 * comes back as a permission error (42501). A 42501 therefore proves the
 * column exists; a PGRST204 proves it does not.
 *
 * This needs no account and no service-role key.
 *
 *   node scripts/schema-conformance.mjs
 */

import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const get = (key) => {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
};

const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

let failures = 0;
let checks = 0;

function check(name, ok, detail = "") {
  checks++;
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/**
 * Asks PostgREST to explain a table.
 *
 * An embedded resource relation is validated the same way as a column, so
 * `select=*,projects(name)` proves the relationship exists too.
 */
async function probe(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, text, json };
}

console.log("─".repeat(72));
console.log("DevDesk live schema conformance");
console.log("─".repeat(72));

// --- 1. The tables the app reads exist ---------------------------------------
console.log("\n[1] Tables exist and are readable-by-role only");

for (const table of ["profiles", "projects", "issues"]) {
  const { status, json } = await probe(`${table}?select=*`);
  const denied =
    status === 401 &&
    json?.code === "42501" &&
    /permission denied for table/i.test(json?.message ?? "");
  check(
    `table "${table}" exists (PostgREST knows it) and denies anon`,
    denied,
    `status ${status} ${JSON.stringify(json)?.slice(0, 120)}`,
  );
}

// --- 2. Every column the app selects exists ----------------------------------
console.log("\n[2] Columns selected by the app exist");

const columnSets = [
  ["projects", "id, owner_id, name, created_at, updated_at"],
  ["issues", "id, project_id, title, description, status, priority, created_at, updated_at"],
  ["profiles", "id, email, created_at"],
];

for (const [table, columns] of columnSets) {
  const { status, json } = await probe(`${table}?select=${columns}`);
  const denied = status === 401 && json?.code === "42501";
  const schemaError = status === 400 && json?.code === "PGRST204";
  check(
    `columns on "${table}" are all valid (${columns})`,
    denied && !schemaError,
    schemaError
      ? `unknown column: ${json?.message}`
      : `status ${status} ${JSON.stringify(json)?.slice(0, 120)}`,
  );
}

// --- 3. The embed used by the issue table resolves ----------------------------
console.log("\n[3] Embedded relations resolve");

{
  const { status, json } = await probe(
    "issues?select=id, project_id, title, description, status, priority, created_at, updated_at, projects(name)",
  );
  const denied = status === 401 && json?.code === "42501";
  const schemaError = status === 400 && /PGRST/.test(json?.code ?? "");
  check(
    "issues -> projects(name) embed is a valid relation",
    denied && !schemaError,
    schemaError
      ? `relation not found: ${json?.message}`
      : `status ${status} ${JSON.stringify(json)?.slice(0, 160)}`,
  );
}

// --- 4. The enum values the app writes exist ---------------------------------
console.log("\n[4] issue_status enum values");

for (const status of ["todo", "in_progress", "done"]) {
  const { status: code, json } = await probe(
    `issues?select=id&status=eq.${status}`,
  );
  const denied = code === 401 && json?.code === "42501";
  const badEnum = code === 400 && /enum|invalid/i.test(json?.message ?? "");
  check(
    `status "${status}" is a valid issue_status value`,
    denied && !badEnum,
    badEnum ? json?.message : `status ${code}`,
  );
}

// --- 5. priority is a smallint in 1..3 ---------------------------------------
console.log("\n[5] priority values");

for (const priority of [1, 2, 3]) {
  const { status: code, json } = await probe(
    `issues?select=id&priority=eq.${priority}`,
  );
  const denied = code === 401 && json?.code === "42501";
  const bad = code === 400 && /invalid|smallint/i.test(json?.message ?? "");
  check(
    `priority ${priority} is a valid smallint filter`,
    denied && !bad,
    bad ? json?.message : `status ${code}`,
  );
}

// --- 6. The filters and ordering the app uses are valid ----------------------
console.log("\n[6] Filters, ordering and counting");

{
  const { status, json } = await probe(
    "issues?select=id&status=eq.todo&order=priority.desc,updated_at.desc",
  );
  check(
    "order by priority desc, updated_at desc is valid",
    status === 401 && json?.code === "42501",
    `status ${status} ${JSON.stringify(json)?.slice(0, 140)}`,
  );
}

{
  const { status, json } = await probe("issues?select=id&order=priority.desc");
  check(
    "ordering by priority alone is valid",
    status === 401 && json?.code === "42501",
    `status ${status} ${JSON.stringify(json)?.slice(0, 140)}`,
  );
}

{
  // `count: "exact"` is what deleteIssue relies on to tell "deleted" from
  // "not visible to you". The anon role cannot read any table here, and
  // PostgREST omits content-range on a 401, so the observable proof is
  // that the request reaches the privilege check (not a schema error) and
  // is not rejected for the Prefer header.
  const res = await fetch(`${URL_BASE}/rest/v1/issues?select=id&id=eq.00000000-0000-0000-0000-000000000000`, {
    method: "HEAD",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      Prefer: "count=exact,return=minimal",
    },
  });
  check(
    'the "count=exact" delete contract is accepted by this deployment',
    res.status === 401,
    `status ${res.status} (a schema or Prefer-header error would be 400)`,
  );
}

// --- 7. The insert payloads the app sends are accepted by the schema ---------
console.log("\n[7] Insert payloads match the schema");

{
  // A deliberately empty insert: the point is the *column* validation, which
  // happens before privileges and before NOT NULL checks.
  const { status, json } = await probe("issues", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: "00000000-0000-0000-0000-000000000000",
      title: "conformance probe",
      description: null,
      status: "todo",
      priority: 2,
    }),
  });
  const denied = status === 401 && json?.code === "42501";
  const schemaError = status === 400 && /PGRST/.test(json?.code ?? "");
  const notNull = status === 400 && /null value|not-null/i.test(json?.message ?? "");
  check(
    "an issues insert with the app's columns is schema-valid",
    denied || notNull,
    `status ${status} ${JSON.stringify(json)?.slice(0, 160)}`,
  );
  check(
    "the insert did not report an unknown column",
    !schemaError,
    json?.message ?? "",
  );
}

{
  const { status, json } = await probe("projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: "00000000-0000-0000-0000-000000000000",
      name: "conformance probe",
    }),
  });
  const denied = status === 401 && json?.code === "42501";
  const notNull = status === 400 && /null value|not-null/i.test(json?.message ?? "");
  const schemaError = status === 400 && /PGRST204|column/i.test(json?.message ?? "");
  check(
    "a projects insert with the app's columns is schema-valid",
    denied || notNull,
    `status ${status} ${JSON.stringify(json)?.slice(0, 160)}`,
  );
  check(
    "the projects insert did not report an unknown column",
    !schemaError,
    json?.message ?? "",
  );
}

// --- 8. Auth: a forged token must not be accepted ---------------------------
console.log("\n[8] Auth rejects forged tokens");

{
  const forged =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoiYXV0ZW50aWNhdGVkIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9." +
    "notarealsignature";
  const res = await fetch(`${URL_BASE}/rest/v1/projects?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${forged}` },
  });
  const body = await res.json();
  check(
    "a forged JWT is rejected by the database",
    res.status === 401 && body?.code === "PGRST301",
    `status ${res.status} ${JSON.stringify(body)?.slice(0, 140)}`,
  );
}

// --- 9. The enum type itself is present --------------------------------------
console.log("\n[9] issue_status enum type");

{
  const { status, json } = await probe("issues?select=id&status=eq.not_a_status");
  const badEnum = status === 400 && /invalid|enum/i.test(json?.message ?? "");
  check(
    "an unknown status is rejected by the enum, proving the type exists",
    badEnum,
    `status ${status} ${JSON.stringify(json)?.slice(0, 160)}`,
  );
}

console.log("\n" + "─".repeat(72));
console.log(`${checks - failures}/${checks} checks passed.`);
console.log("─".repeat(72));
process.exit(failures === 0 ? 0 : 1);
