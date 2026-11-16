import { describe, expect, it } from "vitest";
import { anchorAtMm, placementCentre, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// The tuck snap through the gestures (seating.11, AC-08): a one-piece Select drag, the Object tool's ghost and a
// duplicate's ghost tuck a chair; a group drag and a domain command (MCP's path) never do. roomDoc: 6 × 4 m. The desk:
// x 1.4–2.6, y 3.3–3.9, its front edge y 3.3. The chair, 0.45 × 0.45 at 210° (30° off facing the desk), is centred on
// (2, 2.5); centred on y 2.9 its front comes 0.093 from the edge (7.4 px at zoom 80), and tucked its back edge's
// middle is on y 3.2 at 180°, 0.35 m under. At zoom 80 on Auto a drag moves by multiples of 0.2 m.

const place = (opId: string, kind: string, at: Point, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, rotation });
const CHAIR_AT = { x: 2, y: 2.5 };

function deskAndChair(...more: Command[]): Document {
  return withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 3.9 }), place("chair", "chair", anchorAtMm(CHAIR_AT, 0.45, 210), 210), ...more);
}

const chairs = (doc: Document): Placement[] => Object.values(doc.placements).filter((p) => doc.objects[p.object]?.kind === "chair").sort((a, b) => (a.id < b.id ? -1 : 1));
/** The chair as the running drag would leave it. */
function dragged(shell: FakeShell): Placement | undefined {
  const t = shell.state.tool;
  if (t.name !== "select" || t.state.kind !== "moving" || !t.state.attempt.ok) return undefined;
  return t.state.attempt.doc.placements["chair/p0"];
}
const pose = (p: Placement | undefined) => (p ? { at: p.at, rotation: p.rotation } : null);
/**
 * Tucked at the desk's front at 180°, its back edge's middle on y 3.2 and on `x` to the millimetre: the chair's centre
 * comes from its anchor kept to the millimetre at 210°, so it may lie half a millimetre off the round figure.
 */
function expectTucked(p: { at: Point; rotation: number } | undefined | null, x: number): void {
  expect(p?.rotation).toBe(180);
  expect(p?.at.y).toBe(3.2);
  expect(Math.abs((p?.at.x ?? NaN) - x)).toBeLessThanOrEqual(0.0011);
}

describe("the tuck snap in the gestures (AC-08)", () => {
  it("a Select drag tucks, keeps it tucked sliding along the edge, and releases pulling away", () => {
    const shell = FakeShell.withDocument(deskAndChair());
    shell.moveTo(CHAIR_AT);
    shell.down(CHAIR_AT);
    shell.moveTo({ x: 2, y: 2.9 });
    expectTucked(dragged(shell), 2);
    shell.moveTo({ x: 2.2, y: 2.9 });
    expectTucked(dragged(shell), 2.2);
    shell.moveTo({ x: 1.8, y: 2.9 });
    expectTucked(dragged(shell), 1.8);
    shell.moveTo({ x: 2, y: 2.3 }); // away: the angle at the press again, never an earlier move's
    expect(dragged(shell)?.rotation).toBe(210);
    shell.moveTo({ x: 2.2, y: 2.9 });
    shell.up({ x: 2.2, y: 2.9 });
    expectTucked(chairs(shell.doc())[0], 2.2);
  });

  it("with Ctrl held the drag doesn't snap", () => {
    const shell = FakeShell.withDocument(deskAndChair());
    shell.drag(CHAIR_AT, { x: 2, y: 2.9 }, { ctrl: true });
    expect(chairs(shell.doc())[0]?.rotation).toBe(210);
  });

  it("the Object tool's ghost tucks and its click places the chair tucked", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 3.9 })));
    shell.ui({ type: "pickKind", kind: "chair" });
    const t = shell.state.tool;
    if (t.name !== "object") throw new Error("not the Object tool");
    shell.state = { ...shell.state, tool: { name: "object", state: { ...t.state, rotation: 210 } } };
    shell.moveTo({ x: 2, y: 2.9 });
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost).toMatchObject({ kind: "chair", at: { x: 2, y: 3.2 }, rotation: 180, fits: true });
    shell.click({ x: 2, y: 2.9 });
    expect(pose(chairs(shell.doc())[0])).toEqual({ at: { x: 2, y: 3.2 }, rotation: 180 });
  });

  it("tucked, no guide pulls the chair along the edge", () => {
    // Centred on x 1.66 the tucked chair's box starts at 1.435, within the tolerance of the desk's side line 1.4.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 3.9 })));
    shell.ui({ type: "pickKind", kind: "chair" });
    const t = shell.state.tool;
    if (t.name !== "object") throw new Error("not the Object tool");
    shell.state = { ...shell.state, tool: { name: "object", state: { ...t.state, rotation: 210 } } };
    shell.moveTo({ x: 1.66, y: 2.9 });
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost).toMatchObject({ at: { x: 1.66, y: 3.2 }, rotation: 180, fits: true });
  });

  it("a duplicate's ghost tucks", () => {
    const shell = FakeShell.withDocument(deskAndChair());
    shell.click(CHAIR_AT);
    expect(shell.state.selection).toEqual([{ table: "placements", id: "chair/p0" }]);
    shell.key("d", { meta: true });
    shell.moveTo({ x: 2, y: 2.9 });
    const tool = shell.state.tool;
    const tried = tool.name === "select" && tool.state.kind === "copying" ? tool.state.attempt : null;
    expect(tried?.ok).toBe(true);
    const places = tried?.tried.kind === "places" ? tried.tried.places : [];
    expect(places.map((p) => p.placementId)).toEqual(["chair/p0"]);
    expectTucked(places[0], 2);
    shell.click({ x: 2, y: 2.9 });
    const [original, copy] = chairs(shell.doc());
    expect(pose(original)).toEqual({ at: anchorAtMm(CHAIR_AT, 0.45, 210), rotation: 210 });
    expectTucked(copy, 2);
  });

  it("groups don't tuck", () => {
    const shell = FakeShell.withDocument(deskAndChair(place("box", "block", { x: 4.5, y: 2.5 })));
    shell.click(CHAIR_AT);
    shell.click({ x: 4.5, y: 2 }, { shift: true });
    expect(shell.state.selection).toHaveLength(2);
    shell.drag(CHAIR_AT, { x: 2, y: 2.9 });
    const [chair] = chairs(shell.doc());
    expect(chair?.rotation).toBe(210);
    const centre = chair ? placementCentre(shell.doc(), chair) : null;
    expect(centre?.y).toBeLessThan(3); // moved with the group, not slid in
    expect(centre?.y).toBeGreaterThan(2.6);
  });

  it("a domain command (MCP's place_object) applies no gesture rule", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 3.9 })));
    const at = anchorAtMm({ x: 2, y: 2.9 }, 0.45, 210);
    shell.command(place("mcp", "chair", at, 210));
    expect(pose(chairs(shell.doc())[0])).toEqual({ at, rotation: 210 });
  });
});
