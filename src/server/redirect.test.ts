import { describe, expect, it } from "vitest";

import { resolveRedirectTarget, safeInternalPath } from "@/server/redirect";

/**
 * The `returnTo` field is supplied by the browser and decides where a
 * server action sends the user. If it is not checked, the app becomes an
 * open redirect: an attacker can craft a link that sends a signed-in user
 * to a page of their choosing.
 *
 * These tests pin the rules that make a target safe.
 */

describe("safeInternalPath", () => {
  it("accepts a same-origin relative path", () => {
    expect(safeInternalPath("/projects")).toBe("/projects");
    expect(safeInternalPath("/projects/abc-123")).toBe("/projects/abc-123");
    expect(safeInternalPath("/issues?status=done")).toBe("/issues?status=done");
  });

  it("rejects an absolute URL", () => {
    expect(safeInternalPath("https://evil.example")).toBeNull();
    expect(safeInternalPath("http://evil.example/path")).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    // "//evil.example" is absolute to the browser even though it starts
    // with a slash, which is exactly why a plain startsWith("/") check
    // is not enough.
    expect(safeInternalPath("//evil.example")).toBeNull();
    expect(safeInternalPath("//evil.example/path")).toBeNull();
  });

  it("rejects a backslash variant of a protocol-relative URL", () => {
    // Some browsers treat "/\" as "//".
    expect(safeInternalPath("/\\evil.example")).toBeNull();
  });

  it("rejects an empty or missing value", () => {
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });

  it("rejects a relative path without a leading slash", () => {
    expect(safeInternalPath("projects")).toBeNull();
    expect(safeInternalPath("evil.example")).toBeNull();
  });
});

describe("resolveRedirectTarget", () => {
  it("uses the candidate when it is safe", () => {
    expect(resolveRedirectTarget("/projects/abc-123", "/projects")).toBe(
      "/projects/abc-123",
    );
  });

  it("falls back when the candidate is missing", () => {
    expect(resolveRedirectTarget(null, "/projects")).toBe("/projects");
    expect(resolveRedirectTarget("", "/projects")).toBe("/projects");
  });

  it("falls back when the candidate would leave the site", () => {
    // The fallback is always used for an unsafe value, so a bad returnTo
    // can never send the user off-site.
    expect(resolveRedirectTarget("https://evil.example", "/projects")).toBe(
      "/projects",
    );
    expect(resolveRedirectTarget("//evil.example", "/projects")).toBe(
      "/projects",
    );
  });
});
