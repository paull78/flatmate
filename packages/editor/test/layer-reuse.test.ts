import { describe, expect, it } from "vitest";
import { LAYER_ORDER } from "../src/view/scene";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { labelledDoc } from "./builders";
import { FakeShell } from "./fake-shell";

const layer = (scene: Scene, name: LayerName): readonly Primitive[] => {
  const found = scene.layers.find((l) => l.name === name);
  if (!found) throw new Error(`no ${name} layer`);
  return found.primitives;
};
const texts = (scene: Scene, name: LayerName): string[] =>
  layer(scene, name).flatMap((p) => (p.kind === "text" ? [p.text] : []));

/** A labelled two-room drawing, pointer over the left room's floor (no wall, no tag under it). */
function shell(): FakeShell {
  const s = FakeShell.withDocument(labelledDoc());
  s.moveTo({ x: 1.5, y: 3.2 });
  return s;
}

describe("unchanged layers keep their array (spec §5.9, P3)", () => {
  it("draws zone tags in their own layer, just before annotations", () => {
    expect([...LAYER_ORDER]).toEqual(["grid", "zoneFills", "walls", "tags", "annotations", "overlays", "presence"]);
    const scene = shell().scene();
    expect(texts(scene, "tags")).toEqual(["Room 1", "10.64 m²", "Room 2", "10.64 m²"]);
    expect(texts(scene, "annotations")).toEqual([]);
  });

  it("a pan keeps walls, zoneFills and tags; the grid is new", () => {
    const s = shell();
    const before = s.scene();
    s.wheel(40, 25);
    const after = s.scene();
    for (const name of ["walls", "zoneFills", "tags"] as const) expect(layer(after, name)).toBe(layer(before, name));
    expect(layer(after, "grid")).not.toBe(layer(before, "grid"));
  });

  it("a zoom gives new tags (their size is in pixels) and keeps walls and floors", () => {
    const s = shell();
    const before = s.scene();
    s.wheel(0, -40, { ctrl: true });
    const after = s.scene();
    expect(layer(after, "tags")).not.toBe(layer(before, "tags"));
    expect(layer(after, "walls")).toBe(layer(before, "walls"));
    expect(layer(after, "zoneFills")).toBe(layer(before, "zoneFills"));
  });

  it("selecting a wall gives new walls only; hovering a wall gives new walls", () => {
    const s = shell();
    const before = s.scene();
    s.click({ x: 6, y: 1 }); // the right wall
    const selected = s.scene();
    expect(layer(selected, "walls")).not.toBe(layer(before, "walls"));
    expect(layer(selected, "tags")).toBe(layer(before, "tags"));
    expect(layer(selected, "zoneFills")).toBe(layer(before, "zoneFills"));
    s.moveTo({ x: 0, y: 1 }); // hover the left wall
    expect(layer(s.scene(), "walls")).not.toBe(layer(selected, "walls"));
  });

  it("selecting a room gives new floors and tags (the selected tag is blue), not new walls", () => {
    const s = shell();
    const before = s.scene();
    s.click({ x: 1.5, y: 3.2 }); // the left room's floor
    const after = s.scene();
    expect(layer(after, "zoneFills")).not.toBe(layer(before, "zoneFills"));
    expect(layer(after, "tags")).not.toBe(layer(before, "tags"));
    expect(layer(after, "walls")).toBe(layer(before, "walls"));
  });

  it("the Zone tool gives new floors (unlabelled hints), an invalid drag new walls, an edit everything", () => {
    const s = shell();
    const before = s.scene();
    s.key("z");
    expect(layer(s.scene(), "zoneFills")).not.toBe(layer(before, "zoneFills"));

    const d = shell();
    d.click({ x: 6, y: 1 });
    const selected = d.scene();
    d.moveTo({ x: 6, y: 4 });
    d.down({ x: 6, y: 4 });
    d.moveTo({ x: 1, y: 4 }); // drags the top-right corner across the divider: invalid, drawn red
    const dragging = d.scene();
    expect(layer(dragging, "walls")).not.toBe(layer(selected, "walls"));
    d.up({ x: 1, y: 4 }); // reverts

    const e = shell();
    const unedited = e.scene();
    e.key("Escape");
    e.command({ type: "renameZone", id: "L1", name: "Kitchen" });
    const edited = e.scene();
    for (const name of ["walls", "zoneFills", "tags"] as const) expect(layer(edited, name)).not.toBe(layer(unedited, name));
    expect(texts(edited, "tags")[0]).toBe("Kitchen");
  });

  it("the same state built twice gives the same arrays; another document never gets them", () => {
    const a = shell();
    const sa = a.scene();
    expect(layer(a.scene(), "walls")).toBe(layer(sa, "walls"));
    const b = FakeShell.withDocument(labelledDoc()); // equal content, another document object
    const sb = b.scene();
    expect(layer(sb, "walls")).not.toBe(layer(sa, "walls"));
    expect(layer(sb, "walls")).toEqual(layer(sa, "walls"));
    // Alternating editors (two headless shells) only rebuild; they stay correct.
    expect(layer(a.scene(), "walls")).toEqual(layer(sa, "walls"));
  });
});
