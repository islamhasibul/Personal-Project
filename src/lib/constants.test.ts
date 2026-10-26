import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  PRIORITIES,
  PRIORITY_VALUES,
  STATUSES,
  priorityFromValue,
} from "@/lib/constants";

describe("status constants", () => {
  it("mirrors the issue_status enum", () => {
    expect(STATUSES).toEqual(["todo", "in_progress", "done"]);
    expect(DEFAULT_STATUS).toBe("todo");
  });
});

describe("priority constants", () => {
  it("stores priority as 1=low, 2=medium, 3=high", () => {
    expect(PRIORITIES).toEqual(["low", "medium", "high"]);
    expect(PRIORITY_VALUES).toEqual({ low: 1, medium: 2, high: 3 });
    expect(DEFAULT_PRIORITY).toBe("medium");
  });

  it("orders numerically so sorting by priority is correct", () => {
    const sorted = [...PRIORITIES].sort(
      (a, b) => PRIORITY_VALUES[a] - PRIORITY_VALUES[b],
    );
    expect(sorted).toEqual(["low", "medium", "high"]);
  });

  it("maps a stored smallint back to its priority name", () => {
    expect(priorityFromValue(1)).toBe("low");
    expect(priorityFromValue(2)).toBe("medium");
    expect(priorityFromValue(3)).toBe("high");
  });

  it("falls back to the default for an unknown value", () => {
    expect(priorityFromValue(99)).toBe("medium");
    expect(priorityFromValue(0)).toBe("medium");
  });
});
