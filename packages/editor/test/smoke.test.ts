import { describe, expect, it } from "vitest";
import { ok, unwrap } from "@fm/domain";

describe("@fm/editor smoke", () => {
  it("resolves @fm/domain through the workspace", () => {
    expect(unwrap(ok("editor"))).toBe("editor");
  });
});
