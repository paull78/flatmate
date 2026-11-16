import { describe, expect, it } from "vitest";
import { localDate } from "../src/adapters/web-host";

describe("localDate (export.28)", () => {
  it("is the local calendar date as YYYY-MM-DD, zero-padded", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
