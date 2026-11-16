import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Violation } from "../src/errors";
import type { Document, Opening } from "../src/model";
import { validateDocument } from "../src/validate";
import { rectDoc, withOpening } from "./helpers";

// An opening fits in its wall, and openings stack (sills step 02, AC-02, AC-05; sills.02, .04): sill ≥ 0, a door's
// sill 0, at least 0.30 m tall, 0.10 m of wall above the head, and two openings sharing a stretch of wall keep 0.10 m
// of wall between them. The 2.00 m wall rule is gone. The 6 × 4 room: W1 runs (0, 0) → (6, 0).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
type O = Partial<Opening> & { id: string; offset: number };
const room = (ceiling = 2.5): Document => run(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: ceiling });
const on = (doc: Document, ...os: O[]): Document => os.reduce((d, o) => withOpening(d, { wall: "W1", ...o }), doc);
/** The I12 violations of a document, or [] when valid. */
const i12 = (doc: Document): Violation[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.filter((v) => v.invariant === "I12");
};
const refusal = (doc: Document, cmd: Command): Violation[] => {
  const r = execute(doc, cmd);
  return r.ok ? [] : r.error.violations.filter((v) => v.invariant === "I12");
};

describe("an opening fits in its wall (sills step 02, AC-02)", () => {
  it("keeps 0.10 m of wall above its head: a 1.60 m wall holds a 1.40 m door, not a 1.55 m one", () => {
    const low = run(room(), { type: "setWallTop", wallId: "W1", top: 1.6 });
    expect(i12(on(low, { id: "d", offset: 1, head: 1.4 }))).toEqual([]);
    expect(i12(on(low, { id: "d", offset: 1, head: 1.5 }))).toEqual([]); // exactly 0.10 m
    const [v] = i12(on(low, { id: "d", offset: 1, head: 1.55 }));
    expect(v?.message).toContain("1.55");
    expect(v?.message).toContain("1.60");
    expect(v?.plain).toBe("A door's head must be at least 0.10 m under its wall's top, at 1.60 m");
  });

  it("is at least 0.30 m tall", () => {
    expect(i12(on(room(), { id: "w", offset: 1, kind: "window", sill: 1, head: 1.3 }))).toEqual([]);
    const [v] = i12(on(room(), { id: "w", offset: 1, kind: "window", sill: 1, head: 1.25 }));
    expect(v?.plain).toBe("An opening must be at least 0.30 m tall");
  });

  it("never has a sill below its wall's bottom", () => {
    const [v] = i12(on(room(), { id: "w", offset: 1, kind: "window", sill: -0.1, head: 1 }));
    expect(v?.plain).toBe("A window's sill can't be below its wall's bottom");
  });

  it("a door or doorway starts at its wall's bottom (AC-01)", () => {
    for (const kind of ["swing", "passage"] as const) {
      const [v] = i12(on(room(), { id: "d", offset: 1, kind, sill: 0.1, head: 2.1 }));
      expect(v?.plain).toBe("A door or doorway starts at its wall's bottom");
    }
  });

  it("lowering a wall or the ceiling under a head is refused, with the values", () => {
    const doc = on(room(), { id: "d", offset: 1 }); // 0–2.10
    expect(refusal(doc, { type: "setWallTop", wallId: "W1", top: 2.2 })).toEqual([]);
    const [wall] = refusal(doc, { type: "setWallTop", wallId: "W1", top: 2.15 });
    expect(wall?.plain).toBe("A door's head must be at least 0.10 m under its wall's top, at 2.15 m");
    const [ceiling] = refusal(doc, { type: "setCeiling", height: 2.15 });
    expect(ceiling?.plain).toBe("A door's head must be at least 0.10 m under its wall's top, at 2.15 m");
  });

  it("has no 2.00 m wall rule: a 1.80 m wall holds a 1.50 m door, and a new one gets 1.70", () => {
    const low = run(room(), { type: "setWallTop", wallId: "W1", top: 1.8 });
    expect(i12(on(low, { id: "d", offset: 1, head: 1.5 }))).toEqual([]);
    const added = run(low, { type: "addOpening", opId: "n", wall: "W1", kind: "swing", offset: 3 });
    expect(added.openings["n/d0"]?.head).toBe(1.7);
  });
});

describe("openings stack on a wall (sills step 02, AC-05)", () => {
  it("a window 2.40–2.90 over a door 0–2.10 on the same stretch is accepted under 3.05", () => {
    expect(i12(on(room(3.05), { id: "d", offset: 1 }, { id: "w", offset: 1, kind: "window", width: 0.8, sill: 2.4, head: 2.9 }))).toEqual([]);
  });

  it("with less than 0.10 m of wall between them they are refused", () => {
    const [v] = i12(on(room(3.05), { id: "d", offset: 1 }, { id: "w", offset: 1.2, kind: "window", width: 0.8, sill: 2.15, head: 2.9 }));
    expect(v?.message).toContain("0.05");
    expect(v?.plain).toBe("Stacked openings keep 0.10 m of wall between them");
    expect(i12(on(room(3.05), { id: "d", offset: 1 }, { id: "w", offset: 1.2, kind: "window", width: 0.8, sill: 2.2, head: 2.9 }))).toEqual([]); // exactly 0.10
  });

  it("two openings whose heights overlap still may not overlap along the wall, and touching is fine", () => {
    const [v] = i12(on(room(), { id: "a", offset: 1, kind: "window" }, { id: "b", offset: 1.5, kind: "window" }));
    expect(v?.message).toBe("Window b overlaps window a on wall W1");
    expect(i12(on(room(), { id: "a", offset: 1, kind: "window" }, { id: "b", offset: 2, kind: "window" }))).toEqual([]);
  });

  it("a window may sit over a pocket door's pocket, not beside the door in it", () => {
    const pocket: O = { id: "p", offset: 2, kind: "pocket", hinge: "b" }; // its pocket runs 2.80–3.60, 0–2.10
    expect(i12(on(room(3.05), pocket, { id: "w", offset: 3, kind: "window", width: 0.5, sill: 2.4, head: 2.9 }))).toEqual([]);
    const [v] = i12(on(room(3.05), pocket, { id: "w", offset: 3, kind: "window", width: 0.5, sill: 1, head: 2 }));
    expect(v?.message).toBe("Window w overlaps pocket door p's pocket on wall W1");
  });
});
