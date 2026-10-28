/**
 * End-to-end smoke test against the running dev server.
 *
 * Drives the real HTTP surface of the app: the proxy's route protection,
 * the auth pages, and the server actions. Run with the dev server up:
 *
 *   npm run dev
 *   node scripts/e2e-check.mjs
 */

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

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

async function get(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

console.log("─".repeat(72));
console.log("DevDesk end-to-end smoke test");
console.log("─".repeat(72));

// --- 1. Route protection ------------------------------------------------------
console.log("\n[1] Route protection (signed out)");

const root = await get("/");
check(
  "GET / redirects to /login when signed out",
  root.status === 307 && root.location === "/login",
  `status=${root.status} location=${root.location}`,
);

for (const path of ["/projects", "/issues"]) {
  const res = await get(path);
  check(
    `GET ${path} redirects to /login when signed out`,
    res.status === 307 && (res.location ?? "").startsWith("/login"),
    `status=${res.status} location=${res.location}`,
  );
  check(
    `GET ${path} preserves the destination in ?next=`,
    (res.location ?? "").includes(`next=${encodeURIComponent(path)}`),
    `location=${res.location}`,
  );
}

const projectId = await get("/projects/11111111-1111-4111-8111-111111111111");
check(
  "GET /projects/:id redirects to /login when signed out",
  projectId.status === 307 && (projectId.location ?? "").startsWith("/login"),
  `status=${projectId.status} location=${projectId.location}`,
);

// --- 2. Auth pages render ----------------------------------------------------
console.log("\n[2] Auth pages");

const login = await get("/login");
check("GET /login is 200", login.status === 200, `status=${login.status}`);
check("login page has an email field", login.body.includes('name="email"'));
check("login page has a password field", login.body.includes('name="password"'));
check("login page has a submit button", /<button[^>]*type="submit"/.test(login.body));
check("login page links to signup", login.body.includes('href="/signup"'));
check("login page has no placeholder text", !login.body.includes("not wired up"));

const signup = await get("/signup");
check("GET /signup is 200", signup.status === 200, `status=${signup.status}`);
check("signup page links to login", signup.body.includes('href="/login"'));

// --- 3. Server actions are wired ---------------------------------------------
console.log("\n[3] Server actions are registered in the rendered HTML");

// Next.js embeds the action id in the RSC payload for the form. The id is
// a 40-character hex string.
for (const [path, label] of [
  ["/login", "login form"],
  ["/signup", "signup form"],
]) {
  const res = await get(path);
  const ids = [...res.body.matchAll(/[0-9a-f]{40}/g)].map((m) => m[0]);
  check(
    `${label} carries a server action reference`,
    ids.length > 0,
    "no action id found in payload",
  );
}

// --- 4. Static assets --------------------------------------------------------
console.log("\n[4] Assets and 404 handling");

const notFound = await get("/this-route-does-not-exist");
check(
  "unknown route returns 404",
  notFound.status === 404,
  `status=${notFound.status}`,
);

console.log("\n" + "─".repeat(72));
console.log(`${checks - failures}/${checks} checks passed.`);
console.log("─".repeat(72));
process.exit(failures === 0 ? 0 : 1);
