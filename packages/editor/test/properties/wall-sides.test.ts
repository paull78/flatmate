import { describe, expect, it } from "vitest";
import { PLAIN_WHITE, execute, motifDefaults, motifsFor, sidesOf, unwrap, wallSideRooms, type Command, type Document } from "@fm/domain";
import { wallFieldCommand, wallFields } from "../../src/properties/wall";
import { refusalText } from "../../src/toast-text";
import type { Field } from "../../src/view/view-model-types";
import { LOFT_WALL, labelledDoc, loftWallDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// A wall's sides in Properties (surfaces step 04, inherit step 05, AC-04, AC-05): one section per side, named by what it
// faces. An inherited side shows what it shows, where from, and Customize; a custom side shows Custom with Reset, and
// its Finish and Lower rows, which edit that side only.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const wallSides = (doc: Document, wall: string) => { const w = doc.walls[wall]; return w ? sidesOf(w) : undefined; };
const fieldsOf = (doc: Document, wall: string): Field[] => {
  const p = wallFields(doc, wall);
  return p.kind === "wall" ? p.fields : [];
};
const sections = (doc: Document, wall: string): string[] => [...new Set(fieldsOf(doc, wall).map((f) => f.section).filter((s) => s !== "Wall"))];
const byId = (doc: Document, wall: string, id: string): Field | undefined => fieldsOf(doc, wall).find((f) => f.id === id);

/** The wall whose joints are at these two points, in either order. */
function wallAt(doc: Document, p: { x: number; y: number }, q: { x: number; y: number }): string {
  const at = (id: string, r: { x: number; y: number }) => doc.joints[id]?.x === r.x && doc.joints[id]?.y === r.y;
  const id = Object.values(doc.walls).find((w) => (at(w.a, p) && at(w.b, q)) || (at(w.a, q) && at(w.b, p)))?.id;
  if (!id) throw new Error("no wall");
  return id;
}

// labelledDoc: a 6 × 4 room divided at x = 3 into "Room 1" (left, L1) and "Room 2" (right, L2).
const named = (): Document => ok(labelledDoc(), { type: "renameZone", id: "L1", name: "Bath" }, { type: "renameZone", id: "L2", name: "Hall" });
const sage = { ...motifDefaults("plain"), colour: "#a8b59a" };
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const subway = motifDefaults("subwayTiles");

describe("a wall's sides in Properties (surfaces step 04)", () => {
  it("a shell wall of the Bath reads Bath side and Outside, left side first", () => {
    const doc = named();
    const west = wallAt(doc, { x: 0, y: 0 }, { x: 0, y: 4 });
    const rooms = wallSideRooms(doc, west);
    const names = sections(doc, west);
    expect(names).toHaveLength(2);
    expect([...names].sort()).toEqual(["Bath side", "Outside"]);
    expect(names[0]).toBe(rooms?.left.kind === "room" ? "Bath side" : "Outside");
  });

  it("the partition reads Bath side and Hall side", () => {
    const doc = named();
    expect([...sections(doc, wallAt(doc, { x: 3, y: 0 }, { x: 3, y: 4 }))].sort()).toEqual(["Bath side", "Hall side"]);
  });

  it("a free wall standing in a room reads Left side and Right side (inherit.05)", () => {
    const doc = ok(named(), { type: "addWall", opId: "free", from: { at: { x: 4, y: 1.5 } }, to: { at: { x: 5, y: 1.5 } } });
    expect(sections(doc, wallAt(doc, { x: 4, y: 1.5 }, { x: 5, y: 1.5 }))).toEqual(["Left side", "Right side"]);
  });

  it("an unlabelled room's side is Room side", () => {
    const doc = ok(named(), { type: "deleteEntities", ids: [{ table: "zoneLabels", id: "L1" }] });
    expect([...sections(doc, wallAt(doc, { x: 3, y: 0 }, { x: 3, y: 4 }))].sort()).toEqual(["Hall side", "Room side"]);
  });
});

describe("an inherited side (inherit step 05, AC-05)", () => {
  const partition = (doc: Document) => wallAt(doc, { x: 3, y: 0 }, { x: 3, y: 4 });
  /** The partition's side facing the Bath (L1, x < 3). */
  const bathSide = (doc: Document): "left" | "right" => {
    const f = fieldsOf(doc, partition(doc)).find((x) => x.section === "Bath side");
    return f?.id.startsWith("left") ? "left" : "right";
  };

  it("shows its room's walls default and band, read-only, where they come from, and Customize", () => {
    const doc = ok(named(),
      { type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: sage },
      { type: "setRoomWallFinishes", labelId: "L1", part: "lower", finish: subway, height: 1.2 });
    const wall = partition(doc), side = bathSide(doc);
    const shows = byId(doc, wall, `${side}.shows`);
    expect([shows?.label, shows?.value, shows?.finish]).toEqual(["Finish", "Plain · Sage", { colour: sage.colour, motif: "plain", open: false, fixed: true }]);
    expect(byId(doc, wall, `${side}.showsLower`)?.value).toMatch(/^Subway tiles · .+ to 1\.20 m$/);
    const customize = byId(doc, wall, `${side}.customize`);
    expect([customize?.label, customize?.value, customize?.action]).toEqual(["Bath's walls", "Customize", true]);
    expect(byId(doc, wall, `${side}.finish`)).toBeUndefined(); // nothing to edit in place
  });

  it("an outside side names the house's outside walls; a bare side reads None", () => {
    const doc = named();
    const west = wallAt(doc, { x: 0, y: 0 }, { x: 0, y: 4 });
    const out = wallSideRooms(doc, west)?.left.kind === "outside" ? "left" : "right";
    expect(byId(doc, west, `${out}.customize`)?.label).toBe("Outside walls");
    expect(byId(doc, west, `${out}.shows`)?.value).toBe("None");
    expect(byId(doc, west, `${out}.showsLower`)).toBeUndefined();
  });

  it("Customize sends setWallSide with what the side shows; Plain White when it shows nothing (inherit.02, .04)", () => {
    const doc = ok(named(), { type: "setRoomWallFinishes", labelId: "L1", part: "lower", finish: subway, height: 1.2 });
    const wall = partition(doc), side = bathSide(doc);
    expect(wallFieldCommand(doc, wall, `${side}.customize`, "")).toEqual({ type: "setWallSide", wallId: wall, side, finish: PLAIN_WHITE, lower: subway, height: 1.2 });
    const painted = ok(named(), { type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: sage });
    expect(wallFieldCommand(painted, wall, `${side}.customize`, "")).toEqual({ type: "setWallSide", wallId: wall, side, finish: sage, lower: null });
  });
});

describe("a custom side (inherit step 05, AC-04)", () => {
  const doc0 = named();
  const wall = wallAt(doc0, { x: 0, y: 0 }, { x: 0, y: 4 });
  const custom = ok(doc0, { type: "setWallSide", wallId: wall, side: "left", finish: navy, lower: null });

  it("shows Custom with Reset, then its Finish and Lower rows; its Finish offers no None", () => {
    const reset = byId(custom, wall, "left.reset");
    expect([reset?.label, reset?.value, reset?.action]).toEqual(["Custom", "Reset", true]);
    expect(byId(custom, wall, "row:left.finish")?.value).toBe("Plain · Navy");
    const finish = byId(custom, wall, "left.finish");
    expect(finish?.options?.map((o) => o.value)).toEqual(motifsFor("wall"));
    expect(byId(custom, wall, "row:left.lower.motif")?.value).toBe("None");
    expect(byId(custom, wall, "left.customize")).toBeUndefined();
  });

  it("Reset sends resetWallSide; editing sends setWallFinish for that side only", () => {
    expect(wallFieldCommand(custom, wall, "left.reset", "")).toEqual({ type: "resetWallSide", wallId: wall, side: "left" });
    expect(wallFieldCommand(custom, wall, "left.hex", "#336699")).toEqual({ type: "setWallFinish", wallId: wall, side: "left", part: "finish", finish: { ...navy, colour: "#336699" } });
    expect(wallFieldCommand(custom, wall, "left.lower.motif", "subwayTiles")).toEqual({ type: "setWallFinish", wallId: wall, side: "left", part: "lower", finish: subway, height: 1.2 });
    expect(wallFieldCommand(custom, wall, "right.hex", "#336699")).toBeNull(); // the other side isn't custom
  });

  it("a band's Height edits and refusals come from the domain, naming the range", () => {
    const doc = ok(custom, { type: "setWallFinish", wallId: wall, side: "left", part: "lower", finish: subway, height: 1.2 });
    expect(byId(doc, wall, "left.lower.height")?.value).toBe("1.20");
    expect(wallFieldCommand(doc, wall, "left.lower.height", "0.9")).toEqual({ type: "setWallFinish", wallId: wall, side: "left", part: "lower", finish: subway, height: 0.9 });
    expect(wallFieldCommand(doc, wall, "left.lower.height", "abc")).toBe("notANumber");
    const cmd = wallFieldCommand(doc, wall, "left.lower.height", "3.5");
    const r = execute(doc, cmd as Command);
    expect(r.ok ? "accepted" : refusalText(r.error, doc, cmd as Command)).toBe("Height must be 0.10–3.00");
    const cleared = ok(doc, wallFieldCommand(doc, wall, "left.lower.motif", "none") as Command);
    expect(wallSides(cleared, wall)?.left).toEqual({ finish: navy, lower: null });
  });

  it("Customize opens the side's new Finish row (M2 hands-on)", () => {
    const shell = FakeShell.withDocument(doc0);
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wall } });
    shell.ui({ type: "setField", fieldId: "left.customize", value: "" });
    const p = shell.view().properties;
    const row = "fields" in p ? p.fields.find((f) => f.id === "row:left.finish") : undefined;
    expect(row?.finish?.open).toBe(true);
  });

  it("Customize then Reset are one undo step each, through the shell", () => {
    const shell = FakeShell.withDocument(doc0);
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wall } });
    shell.ui({ type: "setField", fieldId: "left.customize", value: "" });
    expect(wallSides(shell.doc(), wall)?.left?.finish).toEqual(PLAIN_WHITE);
    shell.ui({ type: "setField", fieldId: "left.reset", value: "" });
    expect(wallSides(shell.doc(), wall)).toBeUndefined();
    shell.key("z", { ctrl: true });
    expect(wallSides(shell.doc(), wall)?.left?.finish).toEqual(PLAIN_WHITE);
    shell.key("z", { ctrl: true });
    expect(wallSides(shell.doc(), wall)).toBeUndefined();
  });
});

describe("a wall's colours (surfaces M2 hands-on)", () => {
  it("offer paints first, then the floor's swatches", () => {
    const doc0 = named();
    const wall = wallAt(doc0, { x: 0, y: 0 }, { x: 0, y: 4 });
    const doc = ok(doc0, { type: "setWallSide", wallId: wall, side: "left", finish: motifDefaults("plain"), lower: null });
    const labels = byId(doc, wall, "left.colour")?.options?.map((o) => o.label) ?? [];
    expect(labels.slice(0, 6)).toEqual(["White", "Off-white", "Charcoal", "Navy", "Barn red", "Forest"]);
    expect(labels).toContain("Oak");
  });
});

describe("a wall on a loft in Properties (cycle home, AC-01, AC-13)", () => {
  it("its sides read Left side and Right side, show None, and come from \"On a loft\"", () => {
    const doc = loftWallDoc();
    expect(sections(doc, LOFT_WALL)).toEqual(["Left side", "Right side"]);
    for (const side of ["left", "right"]) {
      expect(byId(doc, LOFT_WALL, `${side}.shows`)?.value).toBe("None");
      expect(byId(doc, LOFT_WALL, `${side}.customize`)?.label).toBe("On a loft");
    }
  });

  it("a custom side shows its own finish; the other stays None", () => {
    const doc = ok(loftWallDoc(), { type: "setWallSide", wallId: LOFT_WALL, side: "left", finish: navy, lower: null });
    expect(byId(doc, LOFT_WALL, "left.shows")).toBeUndefined();
    expect(byId(doc, LOFT_WALL, "right.shows")?.value).toBe("None");
  });
});
