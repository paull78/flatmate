import { describe, expect, it } from "vitest";
import { rememberSection, sectionOpen, type SectionStore } from "../../src/panels/section-open";

// Remembered sections (inherit step 06, AC-08): Shortcuts, Underlay, Trailer and Project start closed, the rest open; a
// toggle is remembered; a blocked or broken storage falls back to the defaults.

function memory(): SectionStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("remembered Properties sections (step 06)", () => {
  it("start with the minor sections closed and the rest open", () => {
    const store = memory();
    for (const t of ["Shortcuts", "Underlay", "Trailer", "Project"]) expect(sectionOpen(t, store), t).toBe(false);
    for (const t of ["Ceiling", "Outside walls", "Rooms", "Room", "Bath side"]) expect(sectionOpen(t, store), t).toBe(true);
  });

  it("store only what differs from the default: a section opening as it mounts leaves nothing", () => {
    const store = memory();
    rememberSection("Ceiling", true, store);
    expect(store.data.get("fm-sections")).toBe("{}");
    rememberSection("Ceiling", false, store);
    rememberSection("Ceiling", true, store);
    expect(store.data.get("fm-sections")).toBe("{}");
  });

  it("remember a toggle, one section at a time", () => {
    const store = memory();
    rememberSection("Project", true, store);
    rememberSection("Ceiling", false, store);
    expect(sectionOpen("Project", store)).toBe(true);
    expect(sectionOpen("Ceiling", store)).toBe(false);
    expect(sectionOpen("Trailer", store)).toBe(false);
  });

  it("fall back to the defaults when storage throws or holds junk", () => {
    const throwing: SectionStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(sectionOpen("Underlay", throwing)).toBe(false);
    expect(() => rememberSection("Underlay", true, throwing)).not.toThrow();
    const junk = memory();
    junk.data.set("fm-sections", "not json");
    expect(sectionOpen("Ceiling", junk)).toBe(true);
  });
});
