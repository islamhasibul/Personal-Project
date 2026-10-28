/**
 * Full authenticated CRUD test, driven through a real browser.
 *
 * Signs in (or signs up, if the project allows it), then exercises the
 * whole loop against the live database:
 *
 *   projects: create -> list -> open -> rename -> delete
 *   issues:   create -> list -> filter -> edit -> delete
 *   logout:   sign out and confirm the protected routes lock again
 *
 * Credentials come from the environment so the test never hard-codes them:
 *
 *   DEVDESK_EMAIL=... DEVDESK_PASSWORD=... node scripts/crud-check.mjs
 *
 * If DEVDESK_EMAIL is not set, the script tries to sign up a fresh account.
 * On a project with email confirmation enabled, signup returns no session,
 * so the account has to be confirmed before this test can run. The script
 * reports which case it hit rather than pretending it passed.
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

function section(title) {
  console.log(`\n${title}`);
}

// --- Obtain a session --------------------------------------------------------
//
// Two routes to a usable account:
//
//   1. DEVDESK_EMAIL / DEVDESK_PASSWORD in the environment. The account
//      must already be confirmed, otherwise sign-in is rejected with
//      "Email not confirmed".
//
//   2. A fresh signup through the real form. This only yields a session
//      when the Supabase project has "Confirm email" turned off. If
//      confirmation is on, the account has to be confirmed by clicking the
//      link in the email before this script can use it.
//
// A third possibility is that the project's email sender is rate limited,
// in which case signup cannot be sent at all. That is reported as its own
// case rather than as a silent failure.
async function getSession() {
  const email = process.env.DEVDESK_EMAIL;
  const password = process.env.DEVDESK_PASSWORD;

  if (email && password) {
    return { email, password };
  }

  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  const newEmail = `devdesk.crud${Date.now()}@gmail.com`;
  await page.fill('input[name="email"]', newEmail);
  await page.fill('input[name="password"]', "DevDeskTest!2345");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  const body = (await page.locator("body").innerText()).toLowerCase();
  const url = page.url();
  await browser.close();

  if (url.includes("/projects")) {
    return { email: newEmail, password: "DevDeskTest!2345", fresh: true };
  }

  if (body.includes("rate limit") || body.includes("too many attempts")) {
    return { blocked: "email-rate-limit" };
  }
  if (body.includes("confirm")) {
    return { blocked: "needs-confirmation", email: newEmail };
  }
  return { blocked: "signup-failed" };
}

// Sign in through the real form so the session cookies are set exactly the
// way a user's browser would set them.
async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/projects", { timeout: 20000 });
  return page.url();
}

// Every route in this app has a `loading.tsx`, so a client-side navigation
// paints a skeleton first and the real content streams in afterwards. A URL
// change therefore says nothing about what is on screen: the page can still
// be showing "Loading projects..." when the next assertion runs.
//
// These helpers wait for the content an assertion is about, so the check
// observes the rendered page rather than a transient loading state. They
// deliberately do not weaken the assertions themselves.
async function waitForContent(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 20000 });
}

async function waitForHeading(page) {
  await waitForContent(page, "h1");
}

console.log("─".repeat(72));
console.log("DevDesk authenticated CRUD check");
console.log("─".repeat(72));

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

// --- 1. Sign in --------------------------------------------------------------
section("[1] Sign in");

let email = process.env.DEVDESK_EMAIL;
let password = process.env.DEVDESK_PASSWORD;

if (!email || !password) {
  const created = await getSession();

  if (created?.blocked === "email-rate-limit") {
    console.log(
      "\n  BLOCKED: the Supabase project's email sender is rate limited, so no\n" +
        "  account can be created or confirmed from here.\n" +
        "  Either confirm one account by hand in the Supabase dashboard and run\n" +
        "  this script with DEVDESK_EMAIL / DEVDESK_PASSWORD, or turn off\n" +
        "  \"Confirm email\" in Authentication -> Sign In / Providers.\n",
    );
    await browser.close();
    process.exit(3);
  }

  if (created?.blocked === "needs-confirmation") {
    console.log(
      "\n  BLOCKED: signup succeeded but the account needs email confirmation.\n" +
        `  Confirm ${created.email} in the Supabase dashboard, then run:\n` +
        `    DEVDESK_EMAIL=${created.email} DEVDESK_PASSWORD=DevDeskTest!2345 \\\n` +
        "      node scripts/crud-check.mjs\n",
    );
    await browser.close();
    process.exit(3);
  }

  if (created) {
    email = created.email;
    password = created.password;
  }
}

if (!email || !password) {
  console.log(
    "\n  SKIPPED: no confirmed account is available.\n" +
      "  Set DEVDESK_EMAIL and DEVDESK_PASSWORD to run this check.\n",
  );
  await browser.close();
  process.exit(2);
}

await signIn(page, email, password);
check("sign in lands on /projects", page.url().endsWith("/projects"), page.url());

// The shell is rendered by the page itself, so wait for it to arrive before
// asserting on the email it carries.
await waitForContent(page, "header");
check(
  "the shell shows the signed-in user's email",
  (await page.locator(`text=${email}`).count()) > 0,
);

// --- 2. Projects CRUD --------------------------------------------------------
section("[2] Projects CRUD");

const projectName = `E2E Project ${Date.now()}`;
await page.fill("#project-name", projectName);
await page.click('button:has-text("Create project")');
// The action redirects back to /projects and the new row is part of the
// re-rendered list, so wait for the row itself rather than a fixed delay.
await waitForContent(page, `a:has-text("${projectName}")`);

check(
  "the new project appears in the list",
  (await page.locator(`a:has-text("${projectName}")`).count()) > 0,
);
check(
  "the create form is cleared after submitting",
  (await page.inputValue("#project-name")) === "",
);

const projectLink = page.locator(`a:has-text("${projectName}")`).first();
await projectLink.click();
await page.waitForURL("**/projects/**", { timeout: 15000 });
check("the project opens its own page", page.url().includes("/projects/"));
await waitForHeading(page);
check(
  "the project page shows the project name",
  (await page.locator(`h1:has-text("${projectName}")`).count()) > 0,
);

// Rename.
const renamed = `${projectName} (renamed)`;
await page.click('button:has-text("Rename")');
await waitForContent(page, 'input[id^="rename-"]');
await page.fill('input[id^="rename-"]', renamed);
await page.click('button:has-text("Save")');
// The rename happens on the project's own page, so the action returns there
// and the heading is re-rendered with the new name.
await page.waitForURL("**/projects/**", { timeout: 15000 });
await waitForContent(page, `h1:has-text("${renamed}")`);
check(
  "the renamed project shows the new name",
  (await page.locator(`h1:has-text("${renamed}")`).count()) > 0,
);

// --- 3. Issues CRUD ----------------------------------------------------------
section("[3] Issues CRUD");

const issueTitle = `E2E Issue ${Date.now()}`;
// The form is part of the streamed page, so wait for it to be there before
// filling it in.
await waitForContent(page, "#issue-title");
await page.fill("#issue-title", issueTitle);
await page.fill(
  "#issue-description",
  "Created by the automated CRUD check.",
);
await page.selectOption("#issue-priority", "high");
await page.click('button:has-text("Create issue")');
// The issue is created on the project's own page, so the action returns
// there and the new issue is listed in that project's table.
await page.waitForURL("**/projects/**", { timeout: 15000 });
await waitForContent(page, `a:has-text("${issueTitle}")`);

check(
  "the new issue appears in the project's issue table",
  (await page.locator(`a:has-text("${issueTitle}")`).count()) > 0,
);
check(
  "the issue shows the priority it was created with",
  (await page.locator('span:has-text("High")').count()) > 0,
);

// --- 4. Status filter --------------------------------------------------------
section("[4] Status filter");

await page.goto(`${BASE}/issues`, { waitUntil: "networkidle" });
await waitForContent(page, "#status-filter");
await waitForContent(page, `a:has-text("${issueTitle}")`);

check(
  "the issues page lists the new issue",
  (await page.locator(`a:has-text("${issueTitle}")`).count()) > 0,
);

// The filter is a GET form that submits on change, so each selection is
// followed by a navigation. Wait for the query string that selection
// produces rather than for a fixed delay.
async function applyFilter(status) {
  await page.selectOption("#status-filter", status);
  await page.waitForURL(`**/issues?status=${status}`, { timeout: 15000 });
  await waitForContent(page, "#status-filter");
}

await applyFilter("done");
check(
  "filtering by a status the issue is not in hides it",
  (await page.locator(`a:has-text("${issueTitle}")`).count()) === 0,
);

await applyFilter("todo");
check(
  "filtering by the issue's status shows it",
  (await page.locator(`a:has-text("${issueTitle}")`).count()) > 0,
);

await applyFilter("all");
check(
  "the 'all' filter shows the issue again",
  (await page.locator(`a:has-text("${issueTitle}")`).count()) > 0,
);

// --- 5. Edit an issue --------------------------------------------------------
section("[5] Edit an issue");

await page.locator(`a:has-text("${issueTitle}")`).first().click();
await page.waitForURL("**/issues/**", { timeout: 15000 });
await waitForContent(page, "#issue-title");

const editedTitle = `${issueTitle} (edited)`;
await page.fill("#issue-title", editedTitle);
await page.selectOption("#issue-status", "done");
await page.selectOption("#issue-priority", "low");
await page.click('button:has-text("Save changes")');
// The update action returns to the issues list, so wait for the edited
// issue to show up there before opening it again.
await page.waitForURL("**/issues", { timeout: 15000 });
await waitForContent(page, `a:has-text("${editedTitle}")`);

// Open the edited issue again: the assertion is about the issue's own
// page, which is where the heading and the badges live.
await page.locator(`a:has-text("${editedTitle}")`).first().click();
await page.waitForURL("**/issues/**", { timeout: 15000 });
await waitForHeading(page);

check(
  "the edited title is shown on the issue page",
  (await page.locator(`h1:has-text("${editedTitle}")`).count()) > 0,
);
check(
  "the new status is shown",
  (await page.locator('span:has-text("Done")').count()) > 0,
);
check(
  "the new priority is shown",
  (await page.locator('span:has-text("Low")').count()) > 0,
);

// The change must survive a reload -- that is what proves it was written
// to the database rather than only to React state.
await page.reload({ waitUntil: "networkidle" });
await waitForHeading(page);
check(
  "the edit survives a reload (it was persisted)",
  (await page.locator(`h1:has-text("${editedTitle}")`).count()) > 0,
);

// --- 6. Delete an issue ------------------------------------------------------
section("[6] Delete an issue");

page.once("dialog", (dialog) => dialog.accept());
await page.click('button:has-text("Delete")');
// The delete action returns to the issues list.
await page.waitForURL("**/issues", { timeout: 15000 });

await page.goto(`${BASE}/issues`, { waitUntil: "networkidle" });
await waitForContent(page, "#status-filter");
check(
  "the deleted issue is gone from the list",
  (await page.locator(`a:has-text("${editedTitle}")`).count()) === 0,
);

// --- 7. Delete the project ---------------------------------------------------
section("[7] Delete the project");

await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
await waitForContent(page, `a:has-text("${renamed}")`);

page.once("dialog", (dialog) => dialog.accept());
const row = page.locator("li", { hasText: renamed });
await row.locator('button:has-text("Delete")').click();
// The delete action returns to the projects list, but the browser is already
// on that URL, so a URL wait would resolve immediately. Wait for the row
// itself to disappear instead -- that is the change being asserted.
await page.locator(`a:has-text("${renamed}")`).first().waitFor({ state: "detached", timeout: 15000 });
await waitForHeading(page);

check(
  "the deleted project is gone from the list",
  (await page.locator(`a:has-text("${renamed}")`).count()) === 0,
);

// --- 8. Log out --------------------------------------------------------------
section("[8] Log out");

await page.click('button:has-text("Log out")');
await page.waitForURL("**/login", { timeout: 15000 });
check("logging out returns to /login", page.url().includes("/login"), page.url());

await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
check(
  "the protected route is locked again after logout",
  page.url().includes("/login"),
  page.url(),
);

// --- 9. Console cleanliness --------------------------------------------------
section("[9] Console cleanliness");
const meaningful = consoleErrors.filter(
  (text) =>
    !/Failed to load resource.*(401|403|400)/i.test(text) &&
    !/ERR_ABORTED/i.test(text) &&
    !/favicon/i.test(text),
);
check(
  "no console errors, page errors, or hydration warnings",
  meaningful.length === 0,
  meaningful.slice(0, 3).join(" | "),
);

await browser.close();

console.log("\n" + "─".repeat(72));
console.log(`${checks - failures}/${checks} checks passed.`);
console.log("─".repeat(72));
process.exit(failures === 0 ? 0 : 1);
