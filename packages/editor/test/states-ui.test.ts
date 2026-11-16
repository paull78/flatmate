import { describe, expect, it } from "vitest";
import { unwrap, execute } from "@fm/domain";
import { bed160x200, roomDoc, studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

describe("layout states in the editor (spec: layouts)", () => {
  it("the active state is the lowest-order state until the user picks one (a migrated drawing shows Layout, AC-12)", () => {
    expect(FakeShell.withDocument(roomDoc()).view().states).toEqual([{ id: "s0", name: "Layout", active: true }]);
    expect(FakeShell.withDocument(studioDoc()).view().states).toEqual([
      { id: "s0", name: "Layout", active: true },
      { id: "n/s0", name: "Night", active: false },
    ]);
    const reordered = studioDoc();
    const doc = { ...reordered, states: { ...reordered.states, "n/s0": { id: "n/s0", name: "Night", order: -1 } } };
    expect(FakeShell.withDocument(doc).view().states[0]).toEqual({ id: "n/s0", name: "Night", active: true });
  });

  it("setActiveState switches the view and sends nothing to the server (AC-05)", () => {
    const r = FakeRemote.open(studioDoc());
    const before = r.shell.doc();
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(r.shell.view().states.map((s) => s.active)).toEqual([false, true]);
    expect(r.submits()).toEqual([]);
    expect(r.shell.doc()).toBe(before);
    r.shell.ui({ type: "setActiveState", id: "nope" }); // ignored
    expect(r.shell.view().states.map((s) => s.active)).toEqual([false, true]);
  });

  it("a taken \"Layout N\" is skipped: the next free one is used (cleanup.09)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "renameState", id: shell.view().states[1]?.id ?? "", name: "Layout 3" });
    shell.ui({ type: "addState" });
    expect(shell.view().states.map((s) => s.name)).toEqual(["Layout", "Layout 3", "Layout 4"]);
  });

  it("addState copies the active state under the next free \"Layout N\" name and makes it active; undo removes it with its placements", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "addState" });
    const states = shell.view().states;
    expect(states.map((s) => [s.name, s.active])).toEqual([["Layout", false], ["Night", false], ["Layout 3", true]]);
    const copy = states[2]?.id ?? "";
    expect(Object.values(shell.doc().placements).filter((p) => p.state === copy)).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.view().states.map((s) => s.name)).toEqual(["Layout", "Night"]);
    expect(Object.keys(shell.doc().placements)).toEqual(["bed/p0"]);
  });

  it("renameState and deleteState commit; deleting the last state toasts the refusal (AC-11)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "renameState", id: "n/s0", name: "Sleep" });
    expect(shell.view().states[1]?.name).toBe("Sleep");
    shell.ui({ type: "deleteState", id: "s0" });
    expect(shell.view().states).toEqual([{ id: "n/s0", name: "Sleep", active: true }]);
    expect(shell.doc().objects).toEqual({}); // the bed lived in Layout only
    shell.ui({ type: "deleteState", id: "n/s0" });
    expect(shell.view().toast).toBe("A drawing keeps at least one layout");
  });

  it("a remote change deleting the active state moves the user to the first remaining state", () => {
    const r = FakeRemote.open(studioDoc());
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    r.remote({ type: "deleteState", stateId: "n/s0" });
    expect(r.shell.view().states).toEqual([{ id: "s0", name: "Layout", active: true }]);
  });
});

describe("objects, warnings and free floor in the scene (spec: layouts)", () => {
  const layer = (shell: FakeShell, name: string) => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];

  it("a bed placed in Layout is drawn there and absent after switching to Night (AC-01)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    expect(layer(shell, "objects").filter((p) => p.kind === "polygon")).toHaveLength(1);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.send({ type: "frame", now: 600 }); // the flip is over
    expect(layer(shell, "objects")).toEqual([]);
  });

  it("a desk whose use zone covers a block adds one warnings polygon, a chair there none; the layer order puts warnings under the walls (AC-03)", () => {
    const desk = unwrap(execute(roomDoc(), { type: "placeObject", deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 2.5 } })).doc;
    const blocked = unwrap(execute(desk, { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "block" }, at: { x: 3, y: 1.8 } })).doc;
    const shell = FakeShell.withDocument(blocked);
    expect(layer(shell, "warnings").filter((p) => p.kind === "polygon")).toHaveLength(1);
    expect(shell.scene().layers.map((l) => l.name)).toEqual(["grid", "ghosts", "finishes", "zoneFills", "deckFloors", "decks", "objects", "overheads", "warnings", "walls", "openings", "deckLabels", "tags", "dimensions", "marks", "annotations", "overlays", "presence"]);
    const seated = unwrap(execute(desk, { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 1.8 } })).doc;
    expect(layer(FakeShell.withDocument(seated), "warnings")).toEqual([]);
  });

  it("one bed blocked on two sides draws two warning polygons, one per side, however many things block a side", () => {
    // The bed: x 0.1–1.7, y 1.9–3.9; its side zones run y 1.9–3.45; its left zone crosses the left wall, a block and a
    // chair both sit in its right zone.
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1, y: 3.9 } },
      bed160x200("bed/o0"),
      { type: "movePlacement", placementId: "bed/p0", at: { x: 0.9, y: 3.9 }, rotation: 0 },
      { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "block" }, at: { x: 2.0, y: 3.0 } },
      { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 2.0, y: 3.6 } },
    );
    const r = (v: number) => +v.toFixed(9) + 0;
    const polygons = layer(FakeShell.withDocument(doc), "warnings").flatMap((p) => (p.kind === "polygon" ? [p.points.map((q) => [r(q.x), r(q.y)])] : []));
    expect(polygons).toEqual([
      [[-0.5, 1.9], [0.1, 1.9], [0.1, 3.45], [-0.5, 3.45]],
      [[1.7, 1.9], [2.3, 1.9], [2.3, 3.45], [1.7, 3.45]],
    ]);
  });
});

describe("room tags show free floor per state (AC-04)", () => {
  const labelled = () => unwrap(execute(studioDoc(), { type: "labelZone", id: "L1", at: { x: 4.5, y: 2 }, name: "Studio", finish: null })).doc;
  const tagTexts = (shell: FakeShell) =>
    (shell.scene().layers.find((l) => l.name === "tags")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));

  it("reads the clear area and the active state's free floor, rounded to 0.1; switching state changes it, not the document", () => {
    const shell = FakeShell.withDocument(labelled());
    expect(tagTexts(shell)).toEqual(["Studio", "5.80 × 3.80 m", "22.04 m² · free 18.8 m²"]); // 5.8 × 3.8 − 1.6 × 2
    const before = shell.doc();
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(tagTexts(shell)).toEqual(["Studio", "5.80 × 3.80 m", "22.04 m² · free 22.0 m²"]);
    expect(shell.doc()).toBe(before);
  });

  it("an unlabelled room holding furniture shows a tag with its area and free floor; an empty unlabelled room shows none (AC-30)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    expect(tagTexts(shell)).toEqual(["22.04 m² · free 18.8 m²"]);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(tagTexts(shell)).toEqual(["22.04 m² · free 22.0 m²"]);
    expect(tagTexts(FakeShell.withDocument(roomDoc()))).toEqual([]);
  });

  it("a room that never holds furniture keeps its plain tag", () => {
    const doc = unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Hall", finish: null })).doc;
    expect(tagTexts(FakeShell.withDocument(doc))).toEqual(["Hall", "5.80 × 3.80 m", "22.04 m²"]);
  });

  it("objects and warnings layers are reused while neither the document nor the state changes (a pan)", () => {
    const shell = FakeShell.withDocument(labelled());
    const objects = shell.scene().layers.find((l) => l.name === "objects")?.primitives;
    expect(objects?.length).toBeGreaterThan(0);
    shell.wheel(30, 0);
    expect(shell.scene().layers.find((l) => l.name === "objects")?.primitives).toBe(objects);
  });
});

describe("object names (layout-states.49)", () => {
  it("are drawn at the footprint's centre, not at the anchor on the back edge (selected only, ux-polish.06)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.click({ x: 1.5, y: 2 });
    const names = (shell.scene().layers.find((l) => l.name === "objects")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.at] : []));
    expect(names).toEqual([{ x: 1.5, y: 2 }]);
  });
});

describe("room properties show free floor (spec: layouts)", () => {
  it("a labelled room holding furniture shows its free floor in the active layout; a plain room does not", () => {
    const doc = unwrap(execute(studioDoc(), { type: "labelZone", id: "L1", at: { x: 4.5, y: 2 }, name: "Studio", finish: null })).doc;
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 4.5, y: 3 }); // empty floor selects the room
    const free = () => fieldsOf(shell).find((f) => f.id === "free")?.value;
    expect(free()).toBe("18.84 m²");
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(free()).toBe("22.04 m²");
    const plain = FakeShell.withDocument(unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Hall", finish: null })).doc);
    plain.click({ x: 3, y: 3 });
    expect(fieldsOf(plain).map((f) => f.id)).toEqual(["name", "area", "row:floor", "floor"]);
  });
});

function fieldsOf(shell: FakeShell) {
  const props = shell.view().properties;
  return "fields" in props ? props.fields.filter((f) => !f.id.replace(/^row:/, "").startsWith("walls")) : []; // the Room section less its walls rows (inherit step 05)
}

