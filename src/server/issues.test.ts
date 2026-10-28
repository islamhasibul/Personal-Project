import { describe, expect, it } from "vitest";

import { normalizeProjectName } from "@/server/projects";
import {
  isStatus,
  toPriorityValue,
  validateIssueFields,
} from "@/server/issues";

/**
 * The validation that runs before a query is sent to the database.
 *
 * These are the rules the database also enforces with CHECK constraints;
 * testing them here proves the user gets a specific message instead of a
 * constraint violation, and that the values handed to Supabase are the
 * ones the schema expects.
 */

describe("isStatus", () => {
  it("accepts the three values of the issue_status enum", () => {
    expect(isStatus("todo")).toBe(true);
    expect(isStatus("in_progress")).toBe(true);
    expect(isStatus("done")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isStatus("DOING")).toBe(false);
    expect(isStatus("")).toBe(false);
    expect(isStatus("todo'")).toBe(false);
  });
});

describe("toPriorityValue", () => {
  it("accepts the three priority names", () => {
    expect(toPriorityValue("low")).toBe("low");
    expect(toPriorityValue("medium")).toBe("medium");
    expect(toPriorityValue("high")).toBe("high");
  });

  it("rejects an unknown name", () => {
    expect(toPriorityValue("urgent")).toBeNull();
    expect(toPriorityValue("")).toBeNull();
  });
});

describe("validateIssueFields", () => {
  const valid = {
    title: "Fix the login button",
    description: "It does nothing on mobile.",
    status: "todo",
    priority: "high",
  };

  it("accepts a complete issue", () => {
    const result = validateIssueFields(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Fix the login button");
    expect(result.value.priority).toBe(3);
    expect(result.value.status).toBe("todo");
  });

  it("trims whitespace from the title and description", () => {
    const result = validateIssueFields({
      ...valid,
      title: "   padded   ",
      description: "  also padded  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("padded");
    expect(result.value.description).toBe("also padded");
  });

  it("treats an empty description as null rather than an empty string", () => {
    const result = validateIssueFields({ ...valid, description: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBeNull();
  });

  it("requires a title", () => {
    const result = validateIssueFields({ ...valid, title: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe("Title is required.");
  });

  it("rejects a title longer than the database allows", () => {
    const result = validateIssueFields({ ...valid, title: "x".repeat(201) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toContain("200");
  });

  it("accepts a title of exactly the maximum length", () => {
    const result = validateIssueFields({ ...valid, title: "x".repeat(200) });
    expect(result.ok).toBe(true);
  });

  it("rejects a description longer than the database allows", () => {
    const result = validateIssueFields({
      ...valid,
      description: "x".repeat(5001),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.description).toContain("5000");
  });

  it("rejects a status that is not in the enum", () => {
    const result = validateIssueFields({ ...valid, status: "in-review" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.status).toBe("Choose a valid status.");
  });

  it("rejects an unknown priority", () => {
    const result = validateIssueFields({ ...valid, priority: "critical" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.priority).toBe("Choose a valid priority.");
  });

  it("reports every bad field at once, so the form can highlight them all", () => {
    const result = validateIssueFields({
      title: "",
      description: "fine",
      status: "nope",
      priority: "nope",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "priority",
      "status",
      "title",
    ]);
  });
});

describe("normalizeProjectName", () => {
  it("trims the name", () => {
    const result = normalizeProjectName("  Marketing  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("Marketing");
  });

  it("requires a name", () => {
    const result = normalizeProjectName("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Project name is required.");
  });

  it("rejects a name longer than the database allows", () => {
    const result = normalizeProjectName("x".repeat(101));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("100");
  });

  it("accepts a name of exactly the maximum length", () => {
    const result = normalizeProjectName("x".repeat(100));
    expect(result.ok).toBe(true);
  });
});
