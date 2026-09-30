import { describe, expect, it } from "vitest";
import { initialState, type Host } from "@fm/editor";

const host: Host = {
  textMetrics: (text, font) => ({ width: text.length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
  now: () => 0,
  newId: () => "id1",
};

describe("@fm/web wiring", () => {
  it("creates a local editor state through the workspace package", () => {
    const state = initialState(
      { mode: "local", me: { clientId: "c1", name: "Guest" }, viewport: { width: 800, height: 600 }, dpr: 1 },
      host,
    );
    expect(state.document?.kind).toBe("local");
    expect(state.tool.name).toBe("select");
  });
});
