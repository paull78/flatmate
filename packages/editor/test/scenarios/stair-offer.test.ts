import { describe, expect, it } from "vitest";
import { validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../../src/tools/types";
import type { Primitive } from "../../src/view/scene-types";
import { roomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// The fix offer (stairdraw.48): before click 1 a red ghost's prompt and chips are live, worked out from the ghost
// under the cursor. Click 1 on a red straight flight pins that point's chips; while the top is fixed no pointer move
// changes or ends them, so the swing on the way up to the hint line (into an L, green or red) keeps them. Click 2, a
// chip click, Esc, a tool change or a level drop ends the offer; a straight flight that fits at click 1 pins nothing.
//
// The 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9) under 3.20, the loft (loft/k0, top 2.15) over x 0.1–1.9; its
// right edge x 1.9 catches. A box at x 4.2–4.8, y 1.7–2.3 leaves 2.30 of free floor in front of the Stair at (1.9, 2):
// 0.69 short, its L and the shorter kinds fit.

const LOFT = "loft/k0";
const base: Command[] = [
  { type: "setCeiling", height: 3.2 },
  { type: "addState", opId: "n", name: "Night" },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.8, name: "Loft" },
];
/** A 0.60 box with its back edge's middle at `at` (it spans y at−0.6 to at), `h` tall. */
const box = (opId: string, at: Point, h = 1): Command[] => [
  { type: "placeObject", linked: false, opId, state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at, rotation: 0, deck: null },
  ...(h === 1 ? [] : [{ type: "setObjectSize", objectId: `${opId}/o0`, w: 0.6, d: { standard: 0.6 }, h: { standard: h }, z: { standard: 0 } } satisfies Command]),
];
function checked(doc: Document): Document {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}
const short = (): Document => checked(withCommands(roomDoc(), ...base, ...box("b", { x: 4.5, y: 2.3 })));
/** `short`, plus a 2.00 tall box under the left L's lower flight (x 3.0–3.6, y 0.8–1.4): from (1.9, 2) the left L is red, the right one fits. */
const leftBlocked = (): Document => checked(withCommands(short(), ...box("l", { x: 3.3, y: 1.4 }, 2)));

function shellOf(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.ui({ type: "pickKind", kind: "stair" });
  return shell;
}
const TOP: Point = { x: 2.6, y: 2.03 };
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const phase = (shell: FakeShell): string | null => (shell.state.tool.name === "object" ? (shell.state.tool.state.stair?.phase ?? null) : null);
// The text before the ghost's numbers (AC-09), which have their own test.
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt.replace(/ · \d+ (risers|rungs) × .*$/, "");
const labels = (shell: FakeShell): string[] => shell.view().commandBar.chips.map((c) => (c.detail === undefined ? c.label : `${c.label} · ${c.detail}`));
const chipId = (shell: FakeShell, label: string): string => {
  const chip = shell.view().commandBar.chips.find((c) => c.label === label);
  if (!chip) throw new Error(`no chip ${label}: ${JSON.stringify(shell.view().commandBar.chips)}`);
  return chip.id;
};
const texts = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const overlays = (shell: FakeShell): string[] => texts(shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []);
const placed = (shell: FakeShell, kind: string): Placement[] =>
  Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === kind).sort((a, b) => a.state.localeCompare(b.state));
/** `n` pointer moves from `from` to `to`, as a hand moves: every one of them on the canvas. */
function moveAlong(shell: FakeShell, from: Point, to: Point, n = 25): void {
  for (let i = 1; i <= n; i++) shell.moveTo({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
}

const SHORT = "Doesn't fit: 0.69 m short";
const CHIPS = ["Make it an L", "Storage stair · 1.99 m", "Ship's ladder · 1.10 m"];

describe("the fix offer (stairdraw.48)", () => {
  it("hovering, a red ghost's prompt and chips are live: they follow the ghost under the cursor", () => {
    const shell = shellOf(short());
    shell.moveTo(TOP);
    expect(prompt(shell)).toBe(`${SHORT}. Click to fix the top, then pick a fix`);
    expect(labels(shell)).toEqual(CHIPS);
    shell.moveTo({ x: 2.6, y: 3.23 }); // slid clear of the box: it fits
    expect(prompt(shell)).toBe("Click to start the stair here, up to the Loft");
    expect(labels(shell)).toEqual([]);
    shell.moveTo(TOP);
    expect(labels(shell)).toEqual(CHIPS);
    shell.moveTo({ x: 5.6, y: 2 }); // off the band: nothing is pinned before click 1
    expect(labels(shell)).toEqual([]);
  });

  it("› fixed: a 25-step path that swings into a red L, then a green one, up off the canvas, keeps click 1's chips; one previews and places", () => {
    const shell = shellOf(leftBlocked());
    shell.click(TOP);
    expect(prompt(shell)).toBe(SHORT);
    expect(labels(shell)).toEqual(CHIPS);
    moveAlong(shell, TOP, { x: 2.6, y: 0.2 }); // sideways to the left: the red L
    expect(ghost(shell)).toMatchObject({ shape: "l-left", fits: false });
    expect(prompt(shell)).toBe(SHORT); // click 1's offer: its prompt and chips, so nothing moves along the line
    expect(labels(shell)).toEqual(CHIPS);
    moveAlong(shell, { x: 2.6, y: 0.2 }, { x: 3.4, y: 6.5 }); // across and up toward the hint line: the green right L
    expect(ghost(shell)).toMatchObject({ shape: "l-right", fits: true });
    expect(prompt(shell)).toBe(SHORT);
    expect(labels(shell)).toEqual(CHIPS);
    shell.send({ type: "pointerLeave" });
    expect(labels(shell)).toEqual(CHIPS);
    shell.ui({ type: "chipHover", id: chipId(shell, "Storage stair") });
    expect(overlays(shell)).toContain("UP · 10 R"); // the storage stair at click 1's point, not the L
    expect(overlays(shell)).not.toContain("UP · 6 R");
    shell.ui({ type: "chipHover", id: null });
    expect(overlays(shell)).toContain("UP · 6 R"); // the frozen L again
    shell.ui({ type: "chipClick", id: chipId(shell, "Storage stair") });
    const stairs = placed(shell, "storageStair");
    expect(stairs.map((p) => [p.state, p.at, p.rotation])).toEqual([["n/s0", { x: 1.9, y: 2 }, 90], ["s0", { x: 1.9, y: 2 }, 90]]);
    expect(shell.doc().objects[stairs[0]?.object ?? ""]?.reaches).toBe(LOFT);
    expect(placed(shell, "stair")).toEqual([]);
    expect(shell.state.objectKind).toBe("stair");
    expect(labels(shell)).toEqual([]); // the offer ended
    shell.key("z", { meta: true }); // one edit
    expect(placed(shell, "storageStair")).toEqual([]);
  });

  it("› a straight flight that fits at click 1 pins nothing, even swung into a red L", () => {
    const shell = shellOf(leftBlocked());
    shell.click({ x: 2.6, y: 3.1 }); // further than 0.30 m from the flush place on the north wall (AC-08)
    expect(phase(shell)).toBe("fixed");
    expect(labels(shell)).toEqual([]);
    shell.moveTo({ x: 2.6, y: 1.6 }); // sideways to the left: the lower flight runs into the tall box
    expect(ghost(shell)).toMatchObject({ shape: "l-left", fits: false });
    expect(labels(shell)).toEqual([]);
    expect(prompt(shell)).toBe("Custom box (0.00–2.00) and Stair (0.00–1.08) overlap in Layout"); // the L's own refusal
  });

  it("› a refused click 2 keeps the offer; a placed one ends it (final gate)", () => {
    const refused = shellOf(short());
    refused.click(TOP);
    const offered = labels(refused);
    expect(offered.length).toBeGreaterThan(0);
    refused.click(TOP); // the red straight flight: refused, still fixed, its fixes still offered
    expect(refused.view().toast).toBe("Custom box (0.00–1.00) and Stair (0.00–2.15) overlap in Layout");
    expect(phase(refused)).toBe("fixed");
    expect(labels(refused)).toEqual(offered);
    const swung = shellOf(short());
    swung.click(TOP);
    swung.moveTo({ x: 2.6, y: 3.0 });
    swung.click({ x: 2.6, y: 3.0 }); // the right L fits: placed
    expect(placed(swung, "stair")).toHaveLength(4);
    expect(labels(swung)).toEqual([]);
    expect(ghost(swung)).toBeNull();
  });

  it("› Esc, a tool change and picking the kind again end it", () => {
    const esc = shellOf(short());
    esc.click(TOP);
    esc.moveTo({ x: 2.6, y: 3.0 });
    esc.key("Escape"); // back to hovering, the pinned chips dropped (hovering shows only live ones)
    expect(phase(esc)).toBe("hover");
    expect(esc.state.tool.name === "object" ? esc.state.tool.state.offer : "not the Object tool").toBeNull();
    esc.click({ x: 2.6, y: 3.23 }); // click 1 where the straight flight fits: no offer, old or new
    expect(phase(esc)).toBe("fixed");
    expect(labels(esc)).toEqual([]);
    const picked = shellOf(short());
    picked.click(TOP);
    picked.ui({ type: "pickKind", kind: "stair" });
    expect(labels(picked)).toEqual([]);
    expect(picked.state.tool.name === "object" ? picked.state.tool.state.offer : "not the Object tool").toBeNull();
    const tool = shellOf(short());
    tool.click(TOP);
    tool.key("v");
    tool.key("o");
    expect(tool.state.tool.name === "object" ? tool.state.tool.state.offer : "not the Object tool").toBeNull();
  });

  it("› after a chip click, and after click 2, no ghost is drawn until the pointer moves on the canvas again", () => {
    const shell = shellOf(short());
    shell.moveTo(TOP);
    shell.send({ type: "pointerLeave" });
    shell.ui({ type: "chipClick", id: chipId(shell, "Make it an L") }); // a live chip, before click 1
    expect(placed(shell, "stair")).toHaveLength(4);
    expect(ghost(shell)).toBeNull();
    expect(overlays(shell).filter((t) => t.startsWith("UP · "))).toEqual([]);
    expect(labels(shell)).toEqual([]);
    shell.moveTo({ x: 2.6, y: 3.23 });
    expect(ghost(shell)).not.toBeNull();
    // Click 2: the stair just placed has no red ghost over it.
    const two = shellOf(checked(withCommands(roomDoc(), ...base)));
    two.click({ x: 2.6, y: 3.23 });
    two.click({ x: 3.4, y: 3.23 });
    expect(placed(two, "stair")).toHaveLength(2);
    expect(ghost(two)).toBeNull();
    two.moveTo({ x: 3.5, y: 3.23 });
    expect(ghost(two)).not.toBeNull();
  });
});
