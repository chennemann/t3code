import { describe, expect, it } from "vite-plus/test";

import { deriveThreadUserMessageRecency } from "./threadRecency.ts";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("deriveThreadUserMessageRecency", () => {
  it("keeps the creation anchor while user messages stay within 36 hours", () => {
    expect(
      deriveThreadUserMessageRecency(createdAt, [
        { role: "user", createdAt: "2026-01-01T00:00:01.000Z" },
        { role: "user", createdAt: "2026-01-02T11:59:59.000Z" },
        { role: "assistant", createdAt: "2026-01-03T00:00:00.000Z" },
        { role: "user", createdAt: "2026-01-03T23:59:58.000Z" },
      ]).recencyAnchorAt,
    ).toBe(createdAt);
  });

  it("re-anchors at the first user message after a 36-hour gap", () => {
    expect(
      deriveThreadUserMessageRecency(createdAt, [
        { role: "user", createdAt: "2026-01-01T01:00:00.000Z" },
        { role: "user", createdAt: "2026-01-02T13:00:00.000Z" },
        { role: "user", createdAt: "2026-01-02T14:00:00.000Z" },
      ]).recencyAnchorAt,
    ).toBe("2026-01-02T13:00:00.000Z");
  });

  it("advances again after each later inactivity gap", () => {
    expect(
      deriveThreadUserMessageRecency(createdAt, [
        { role: "user", createdAt: "2026-01-01T01:00:00.000Z" },
        { role: "user", createdAt: "2026-01-02T13:00:00.000Z" },
        { role: "user", createdAt: "2026-01-04T01:00:00.000Z" },
      ]).recencyAnchorAt,
    ).toBe("2026-01-04T01:00:00.000Z");
  });

  it("uses an exact 36-hour gap as re-engagement", () => {
    const resumedAt = "2026-01-02T13:00:00.000Z";

    expect(
      deriveThreadUserMessageRecency(createdAt, [
        { role: "user", createdAt: "2026-01-01T01:00:00.000Z" },
        { role: "user", createdAt: resumedAt },
      ]).recencyAnchorAt,
    ).toBe(resumedAt);
  });
});
