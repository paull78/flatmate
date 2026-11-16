import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialState, type Host } from "@fm/editor";

const host: Host = {
  now: () => 0,
  today: () => "2026-10-13",
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

  it("index.html links a favicon that exists in public/ (AC-20)", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const link = /<link rel="icon" href="\/([^"]+)" type="image\/svg\+xml"/.exec(html);
    expect(link).not.toBeNull();
    const file = new URL(`../public/${link?.[1] ?? ""}`, import.meta.url);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
});
