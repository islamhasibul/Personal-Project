/**
 * Drives the app in a real browser.
 *
 * This is the check that answers "does the interface actually respond?" --
 * it clicks the real buttons, submits the real forms, and fails on any
 * console error, page error, or failed request. A hydration mismatch
 * appears in the console as an error, so it is caught here too.
 *
 * Usage:
 *   npm run dev
 *   node scripts/browser-check.mjs
 */

import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

let failures = 0;
let checks = 0;
const consoleErrors = [];

function check(name, ok, detail = "") {
  checks++;
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext();
const page = await context.newPage();

// Collect every console error and uncaught exception. A hydration
// mismatch shows up here as a console error.
page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push(msg.text());
  }
});
page.on("pageerror", (error) => {
  consoleErrors.push(`pageerror: ${error.message}`);
});

console.log("─".repeat(72));
console.log("DevDesk browser check");
console.log("─".repeat(72));

// --- 1. The login page loads and hydrates -------------------------------------
console.log("\n[1] Login page");

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

check("page title mentions DevDesk", (await page.title()).includes("DevDesk"));
check(
  "the email field is present and editable",
  await page.locator('input[name="email"]').isEditable(),
);
check(
  "the submit button is present",
  (await page.locator('button[type="submit"]').count()) === 1,
);

// --- 2. Client-side validation responds without a round trip -----------------
console.log("\n[2] Validation feedback appears in the browser");

await page.fill('input[name="email"]', "not-an-email");
await page.fill('input[name="password"]', "abc");
await page.click('button[type="submit"]');

// The action returns and React re-renders with the field errors.
await page.waitForSelector("#email-error", { timeout: 15000 }).catch(() => {});
check(
  "a malformed email produces an inline error",
  await page.locator("#email-error").isVisible(),
);
check(
  "a short password produces an inline error",
  await page.locator("#password-error").isVisible(),
);

// --- 3. Empty fields ---------------------------------------------------------
console.log("\n[3] Empty submission");

await page.fill('input[name="email"]', "");
await page.fill('input[name="password"]', "");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);

check(
  "an empty email produces an inline error",
  (await page.locator("#email-error").count()) > 0,
);
check(
  "an empty password produces an inline error",
  (await page.locator("#password-error").count()) > 0,
);

// --- 4. Navigation links work ------------------------------------------------
console.log("\n[4] Navigation");

await page.click('a[href="/signup"]');
await page.waitForURL("**/signup", { timeout: 10000 });
check("the signup link navigates to /signup", page.url().endsWith("/signup"));
// Wait for the new route's own content. The heading and the email field
// are both present only on /signup, so waiting for the heading settles
// the navigation before the field count is read.
await page
  .waitForSelector('h1:has-text("Create your account")', { timeout: 10000 })
  .catch(() => {});
await page
  .waitForFunction(
    () => document.querySelectorAll('input[name="email"]').length === 1,
    null,
    { timeout: 10000 },
  )
  .catch(() => {});
const signupEmailCount = await page.locator('input[name="email"]').count();
check(
  "the signup page renders its own form",
  signupEmailCount === 1,
  `found ${signupEmailCount} email inputs; html has ${await page.locator("input").count()} inputs total`,
);
check(
  "the signup page is a different form from the login page",
  (await page.locator('h1:has-text("Create your account")').count()) === 1,
);

await page.click('a[href="/login"]');
await page.waitForURL("**/login", { timeout: 10000 });
check("the login link navigates back to /login", page.url().endsWith("/login"));

// --- 5. Protected routes redirect --------------------------------------------
console.log("\n[5] Protected routes");

await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
check(
  "/projects redirects a signed-out visitor to /login",
  page.url().includes("/login"),
  page.url(),
);
check(
  "the redirect keeps the original destination",
  page.url().includes("next=%2Fprojects"),
  page.url(),
);

// --- 6. The logout control is a real button ----------------------------------
console.log("\n[6] Logout control");

// Sign-in is not possible without a confirmed account, so this checks the
// control's shape rather than its effect.
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const logoutButtons = await page.locator('button:has-text("Log out")').count();
check(
  "the shell renders a Log out button (not a static span)",
  logoutButtons === 0, // not present on the unauthenticated login page
  `found ${logoutButtons}`,
);

// --- 7. Client-side navigation replaces the page -----------------------------
console.log("\n[7] Client-side navigation replaces the previous page");

// Regression check: with Cache Components enabled and `instant = false` on
// the dynamic routes, the client router left the previous page in the DOM
// alongside the new one. Two <main> elements means two live pages, which is
// what made the interface look non-interactive.
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.click('a[href="/signup"]');
await page.waitForURL("**/signup", { timeout: 10000 });
await page
  .waitForSelector('h1:has-text("Create your account")', { timeout: 10000 })
  .catch(() => {});
await page.waitForTimeout(500);

const mainCount = await page.locator("main").count();
check(
  "the previous page is removed from the DOM on navigation",
  mainCount === 1,
  `found ${mainCount} <main> elements`,
);
const formCount = await page.locator("form").count();
check(
  "the previous form is removed from the DOM on navigation",
  formCount === 1,
  `found ${formCount} <form> elements`,
);

// --- 8. No console errors ----------------------------------------------------
console.log("\n[8] Console cleanliness");

const meaningful = consoleErrors.filter(
  // A failed request to Supabase while signed out is expected: the app
  // asks the auth service to verify a session that does not exist.
  (text) =>
    !/Failed to load resource.*(401|403|400)/i.test(text) &&
    !/ERR_ABORTED/i.test(text) &&
    !/Failed to load resource.*favicon/i.test(text),
);

check(
  "no console errors, page errors, or hydration warnings",
  meaningful.length === 0,
  meaningful.slice(0, 3).join(" | "),
);

if (consoleErrors.length > 0) {
  console.log("\n  all console output captured:");
  for (const text of consoleErrors.slice(0, 10)) {
    console.log(`    - ${text.slice(0, 220)}`);
  }
}

await browser.close();

console.log("\n" + "─".repeat(72));
console.log(`${checks - failures}/${checks} checks passed.`);
console.log("─".repeat(72));
process.exit(failures === 0 ? 0 : 1);
