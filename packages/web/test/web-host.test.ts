import { describe, expect, it } from "vitest";
import { fontString } from "../src/adapters/web-host";

describe("fontString", () => {
  it("defaults the weight to 400", () => {
    expect(fontString({ family: "Inter, system-ui, sans-serif", size: 12 })).toBe("400 12px Inter, system-ui, sans-serif");
  });

  it("keeps an explicit weight", () => {
    expect(fontString({ family: "Inter", size: 11, weight: 600 })).toBe("600 11px Inter");
  });
});
