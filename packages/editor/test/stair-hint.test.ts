import { describe, expect, it } from "vitest";
import { shown, stairGeometry, stairRuleOf, type LayoutObject, type StairGeometry, validateDocument, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The hint line's prompt for each state of the stair gesture (AC-08, AC-11; spec "Hints and fixes", stairdraw.12).
// The 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9) under 3.20; the loft (loft/k0, "Loft", top 2.15) over x 0.1–1.9,
// so only its right edge, x 1.9, catches. From (1.9, 2) a Stair's L splits 6 and 6, its landing at +1.075.

const base: Command[] = [{ type: "setCeiling", height: 3.2 }];
const loft: Command = { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.8, name: "Loft" };
const TOP: Point = { x: 2.6, y: 2.03 };

function checked(doc: Document): Document {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}
function shellOf(doc: Document, kind = "stair"): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.ui({ type: "pickKind", kind });
  return shell;
}
const loftRoom = (): FakeShell => shellOf(checked(withCommands(roomDoc(), ...base, loft)));
// The text before the ghost's numbers (AC-09), which have their own test.
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt.replace(/ · \d+ (risers|rungs) × .*$/, "");

describe("the stair hint (AC-11)", () => {
  it("each state gives its prompt from the spec's table", () => {
    const shell = loftRoom();
    shell.moveTo({ x: 5.3, y: 2 });
    expect(prompt(shell)).toBe("Move near a deck's edge to go up to it, or click to place a stair that reaches nothing");
    shell.moveTo(TOP);
    expect(prompt(shell)).toBe("Click to start the stair here, up to the Loft");
    shell.click(TOP);
    shell.moveTo({ x: 3.4, y: 2.21 });
    expect(prompt(shell)).toBe("Click to place, or move sideways for an L. Esc cancels");
    shell.moveTo({ x: 2.6, y: 3.0 });
    expect(prompt(shell)).toBe("Click to place the L: two flights and a landing at +1.08");
    shell.key("Escape");
    expect(prompt(shell)).toBe("Click to start the stair here, up to the Loft");
    expect(shell.view().commandBar.chips).toEqual([]);
  });

  it("› a kind that doesn't turn asks for one click; dragged, the prompt names the kind's label (AC-08, stairdraw.56)", () => {
    const shell = shellOf(checked(withCommands(roomDoc(), ...base, loft)), "shipsLadder");
    shell.moveTo({ x: 2.3, y: 2.03 });
    expect(prompt(shell)).toBe("Click to place it here, up to the Loft");
    shell.down({ x: 2.3, y: 2.03 });
    shell.moveTo({ x: 2.3, y: 3.2 }); // dragged sideways: still straight
    expect(prompt(shell)).toBe("Release to place. Ship's ladder doesn't turn. Esc cancels");
  });

  it("› a stair too low to turn asks for one click; dragged, it gives the domain's reason (stairdraw.58)", () => {
    const shell = shellOf(checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 3.8, name: "Platform" })));
    shell.moveTo({ x: 1.5, y: 2.03 });
    expect(prompt(shell)).toBe("Click to place it here, up to the Platform");
    shell.down({ x: 1.5, y: 2.03 });
    shell.moveTo({ x: 1.5, y: 3.0 });
    expect(prompt(shell)).toBe("Release to place. Too low for an L: each flight needs two risers. Esc cancels");
  });

  it("› a stair that doesn't fit says how short it is, hovering and fixed, and click 2 toasts the refusal (AC-12)", () => {
    // A box in front of the loft's edge, x 2.3–2.9, across the band around y 3: the hovered stair runs into it 0.40 out,
    // so it is 2.988 − 0.40 = 2.59 short (stairdraw.19). An open stair passes over the 1.00 box.
    const shell = shellOf(
      checked(withCommands(roomDoc(), ...base, loft, { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 2.6, y: 3.2 }, rotation: 0, deck: null })),
    );
    shell.moveTo({ x: 2.6, y: 3.23 });
    expect(prompt(shell)).toBe("Doesn't fit: 2.59 m short. Click to fix the top, then pick a fix");
    expect(shell.view().commandBar.prompt).not.toContain("risers"); // a red ghost shows no numbers (AC-09)
    expect(shell.view().commandBar.chips[0]).toEqual({ id: "openStair/straight", label: "Open stair", detail: "2.99 m" });
    shell.click({ x: 2.6, y: 3.23 });
    expect(prompt(shell)).toBe("Doesn't fit: 2.59 m short");
    shell.click({ x: 2.6, y: 3.23 }); // click 2 refuses, toasting the commit's reason
    expect(shell.view().toast).toBe("Custom box (0.00–1.00) and Stair (0.00–2.15) overlap in Layout");
    // Fixed near the low end, swinging left runs the L's lower flight through the wall: an L gives the refusal itself,
    // the words the click toasts.
    shell.key("Escape");
    shell.click({ x: 2.6, y: 0.6 });
    shell.moveTo({ x: 2.6, y: -0.4 });
    const red = prompt(shell);
    expect(red).toBe("Stair (0.00–1.08) overlaps a wall in Layout");
    shell.click({ x: 2.6, y: -0.4 });
    expect(shell.view().toast).toBe(red);
  });

  it("› with nothing that fits, it says so, with no chips (AC-12)", () => {
    // A 2.00 tall box right at the loft's edge, across the stair: no kind, straight or as an L, starts there.
    const doc = checked(
      withCommands(
        roomDoc(),
        ...base,
        loft,
        { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 2.2, y: 2.3 }, rotation: 0, deck: null },
        { type: "setObjectSize", objectId: "b/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 2 }, z: { standard: 0 } },
      ),
    );
    const shell = shellOf(doc);
    shell.moveTo(TOP);
    expect(prompt(shell)).toBe("Doesn't fit here: slide along the edge or try another edge");
    expect(shell.view().commandBar.chips).toEqual([]);
  });

  it("the furniture prompt is unchanged when the armed kind isn't a stair (regression)", () => {
    const shell = shellOf(checked(withCommands(roomDoc(), ...base, loft)), "bed");
    shell.moveTo(TOP);
    expect(shell.view().commandBar).toEqual({ prompt: "Click inside a room to place, or drag to draw its footprint", value: "", unit: null, chips: [] });
  });
});

describe("the chip events (stairdraw.13)", () => {
  it("a chip that isn't offered, or chips over a stair that fits, change nothing", () => {
    const shell = loftRoom();
    shell.click(TOP);
    const before = shell.state;
    shell.ui({ type: "chipHover", id: "x" });
    shell.ui({ type: "chipHover", id: null });
    shell.ui({ type: "chipClick", id: "x" });
    shell.ui({ type: "chipClick", id: "storageStair/straight" }); // a real id, but the stair fits: no chips
    expect(shell.state).toEqual(before);
  });
});

describe("the ghost's numbers (AC-09)", () => {
  const stairs = (shell: FakeShell) => Object.values(shell.doc().objects).filter((o) => stairRuleOf(o.kind) !== null);
  const numbersOf = (o: LayoutObject): StairGeometry => {
    const rule = stairRuleOf(o.kind);
    if (!rule) throw new Error("no rule");
    return stairGeometry(rule, o.w.standard ?? 0, o.d.standard ?? 0, o.h.standard ?? 0, null);
  };

  it("hovering, reads risers × riser, going and run, and they are what gets placed", () => {
    const shell = loftRoom();
    shell.moveTo(TOP);
    const hint = shell.view().commandBar.prompt;
    expect(hint).toMatch(/^Click to start the stair here, up to the Loft · \d+ risers × 0\.\d{3} · going 0\.\d{2} · run \d\.\d{2}$/);
    shell.click(TOP);
    shell.moveTo({ x: 3.4, y: 2.21 });
    expect(shell.view().commandBar.prompt).toMatch(/^Click to place, or move sideways for an L\. Esc cancels · \d+ risers/);
    shell.click({ x: 3.4, y: 2.21 });
    const [placed] = stairs(shell);
    if (!placed) throw new Error("nothing placed");
    const g = numbersOf(placed);
    expect(hint).toContain(`${g.risers} risers × ${shown(g.riser, 3)} · going ${shown(g.going, 2)} · run ${shown(g.run, 2)}`);
  });

  it("an L reads the whole count and the going, with no single run", () => {
    const shell = loftRoom();
    shell.moveTo(TOP);
    shell.click(TOP);
    shell.moveTo({ x: 2.6, y: 3.0 });
    expect(shell.view().commandBar.prompt).toMatch(/^Click to place the L: two flights and a landing at \+1\.08 · \d+ risers × 0\.\d{3} · going 0\.\d{2}$/);
  });
});
