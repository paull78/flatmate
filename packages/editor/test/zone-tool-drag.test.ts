import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { REST_TIMER } from "../src/plate";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Zone tool's drag (areas step 05, areas.06, .15, AC-05, AC-07): a drag of at least 0.30 m both ways draws a named
// area with the Deck tool's snapping, red with its reason where refused; anything smaller is a click. roomDoc: a 6 × 4
// room of 0.20 m walls, faces x 0.1–5.9, y 0.1–3.9.

type Segment = Extract<Primitive, { kind: "segment" }>;
const overlays = (shell: FakeShell): Segment[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "segment" ? [p] : []));
const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const areas = (shell: FakeShell) => Object.values(shell.doc().areas).map(({ id: _id, ...a }) => a);

function zone(doc: Document = roomDoc()): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.key("z");
  return shell;
}
function pressAndDrag(shell: FakeShell, from: Point, to: Point, ctrl = false): void {
  shell.moveTo(from, { ctrl });
  shell.down(from, { ctrl });
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { ctrl });
  shell.moveTo(to, { ctrl });
}
function drag(shell: FakeShell, from: Point, to: Point, ctrl = false): void {
  pressAndDrag(shell, from, to, ctrl);
  shell.up(to, { ctrl });
}

describe("the Zone tool's drag (AC-05)", () => {
  it("a 2.00 × 1.50 drag adds Area 1, then the Select tool has it selected with its grips; Z and a drag add Area 2; one undo removes the last (areas.41)", () => {
    const shell = zone();
    drag(shell, { x: 1, y: 1 }, { x: 3, y: 2.5 }, true);
    expect(areas(shell)).toEqual([{ name: "Area 1", at: { x: 2, y: 1.75 }, w: 2, d: 1.5 }]);
    expect(shell.view().activeTool).toBe("select");
    expect(shell.state.selection).toEqual([{ table: "areas", id: "id1/a0" }]);
    expect(handles(shell.state, shell.doc()).filter((h) => h.kind === "areaSide")).toHaveLength(4);
    shell.key("z");
    drag(shell, { x: 3.5, y: 1 }, { x: 5, y: 2 }, true);
    expect(areas(shell).map((a) => a.name)).toEqual(["Area 1", "Area 2"]);
    shell.key("z", { meta: true });
    expect(areas(shell).map((a) => a.name)).toEqual(["Area 1"]);
  });

  it("a refused drag stays in the Zone tool; a click naming a room does too", () => {
    const refused = zone();
    drag(refused, { x: 5, y: 1 }, { x: 8, y: 3 }, true); // centre outside the room
    expect(refused.view().activeTool).toBe("zone");
    const named = zone();
    named.click({ x: 2, y: 2 });
    expect(named.view().activeTool).toBe("zone");
  });

  it("the Zone tool's cursor is a crosshair, the Floor mode's a pointer (areas.41)", () => {
    expect(zone().view().cursor).toBe("crosshair");
    const floor = FakeShell.withDocument(roomDoc());
    floor.ui({ type: "pickMotif", motif: "planks" });
    expect(floor.view().cursor).toBe("pointer");
  });

  it("its corners snap to the wall faces' corners, and to the cm only with Ctrl", () => {
    const snapped = zone();
    drag(snapped, { x: 0.13, y: 0.12 }, { x: 2.0, y: 3.87 });
    const a = areas(snapped)[0];
    expect(a && a.at.x - a.w / 2).toBeCloseTo(0.1, 9);
    expect(a && a.at.y + a.d / 2).toBeCloseTo(3.9, 9);
    const free = zone();
    drag(free, { x: 0.13, y: 0.12 }, { x: 2.0, y: 3.87 }, true);
    const b = areas(free)[0];
    expect(b && b.at.x - b.w / 2).toBeCloseTo(0.13, 9);
  });

  it("a drag under 0.30 m on a side labels the room and adds no area; a click still labels, then selects, the room", () => {
    const short = zone();
    drag(short, { x: 2, y: 2 }, { x: 2.2, y: 3 }, true); // 0.20 × 1.00
    expect(areas(short)).toEqual([]);
    expect(Object.values(short.doc().zoneLabels).map((l) => l.name)).toEqual(["Room 1"]);
    const clicks = zone();
    clicks.click({ x: 2, y: 2 });
    expect(Object.values(clicks.doc().zoneLabels).map((l) => l.name)).toEqual(["Room 1"]);
    const label = Object.keys(clicks.doc().zoneLabels)[0];
    clicks.click({ x: 4, y: 3 });
    expect(clicks.state.selection).toEqual([{ table: "zoneLabels", id: label }]);
    expect(areas(clicks)).toEqual([]);
  });

  it("shows no outline while the drag is under 0.30 m, and the draft once it is past", () => {
    const shell = zone();
    pressAndDrag(shell, { x: 2, y: 2 }, { x: 2.2, y: 2.2 }, true);
    expect(overlays(shell)).toEqual([]);
    shell.moveTo({ x: 3, y: 3 }, { ctrl: true });
    expect(overlays(shell)).toHaveLength(4);
  });
});

describe("refused drags (AC-07)", () => {
  const withKitchen = (): Document => run(roomDoc(), { type: "addArea", opId: "k", at: { x: 1.1, y: 2 }, w: 2, d: 3.8, name: "Kitchen" });

  it("a drag into another area previews red, says Overlaps Kitchen at the pointer after a rest, and adds nothing", () => {
    const shell = zone(withKitchen());
    pressAndDrag(shell, { x: 1.5, y: 1 }, { x: 3.5, y: 3 }, true);
    expect(overlays(shell).every((s) => s.color === COLORS.invalid)).toBe(true);
    shell.fireTimer(REST_TIMER);
    expect(shell.state.plate?.text).toBe("Overlaps Kitchen");
    shell.up({ x: 3.5, y: 3 }, { ctrl: true });
    expect(areas(shell).map((a) => a.name)).toEqual(["Kitchen"]);
    expect(shell.view().toast).toBe("Overlaps Kitchen");
  });

  it("a drag whose centre is outside every room is refused with Draw an area inside a room", () => {
    const shell = zone();
    drag(shell, { x: 5, y: 1 }, { x: 8, y: 3 }, true); // centre x 6.5, past the wall
    expect(areas(shell)).toEqual([]);
    expect(shell.view().toast).toBe("Draw an area inside a room");
  });

  it("a corner snaps onto another area's side, so the two meet edge to edge and are accepted", () => {
    const shell = zone(withKitchen()); // Kitchen's right side at x 2.1
    drag(shell, { x: 2.12, y: 1 }, { x: 4, y: 3 });
    const lefts = Object.fromEntries(areas(shell).map((a) => [a.name, a.at.x - a.w / 2]));
    expect(lefts["Area 1"]).toBeCloseTo(2.1, 9);
    expect(Object.keys(lefts)).toEqual(["Kitchen", "Area 1"]);
  });
});

describe("the Floor mode", () => {
  it("a drag in the Floor mode adds no area", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickMotif", motif: "planks" });
    drag(shell, { x: 1, y: 1 }, { x: 3, y: 3 }, true);
    expect(areas(shell)).toEqual([]);
  });
});
