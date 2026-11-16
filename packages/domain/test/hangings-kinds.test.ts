import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { MIN_OBJECT_SIZE, kindOf } from "../src/kinds";
import type { Document } from "../src/model";
import { docOf } from "./helpers";

// The hung pieces and the coat stand (hangings step 01, AC-01, AC-02, AC-04): seven kinds with presets that give width,
// depth, height and elevation; the towel rail's presets; pieces as thin as 2 cm (hangings.02, .03).

const NEW = ["picture", "mirror", "clock", "wallTv", "pegboard", "coatHooks", "coatStand"] as const;

/** A 6 × 4 room; the piece goes in its middle, clear of the walls. */
const room = (): Document => docOf({
  joints: [["A", 0, 0], ["B", 6, 0], ["C", 6, 4], ["D", 0, 4]],
  walls: [["AB", "A", "B"], ["BC", "B", "C"], ["CD", "C", "D"], ["DA", "D", "A"]],
});
const firstState = (doc: Document): string => Object.keys(doc.states)[0] ?? "";
function placed(kind: string, preset?: string): { doc: Document; object: string } {
  const doc0 = room();
  const cmd: Command = { type: "placeObject", opId: "p", state: firstState(doc0), object: { kind, ...(preset ? { preset } : {}) }, at: { x: 3, y: 2 }, rotation: 0, deck: null };
  const r = execute(doc0, cmd);
  if (!r.ok) throw new Error(`${kind} ${preset ?? ""}: ${r.error.message}`);
  return { doc: r.value.doc, object: "p/o0" };
}

describe("the hung pieces and the coat stand (step 01, AC-01)", () => {
  it("each new kind's presets give width, depth, height and elevation, and its default size is one of them", () => {
    for (const id of NEW) {
      const k = kindOf(id);
      expect(k, id).toBeDefined();
      const presets = k?.presets ?? [];
      expect(presets.length, id).toBeGreaterThanOrEqual(2);
      for (const p of presets) {
        expect(p.h, `${id} ${p.id}`).toBeDefined();
        if (id !== "coatStand") expect(p.z, `${id} ${p.id}`).toBeDefined();
      }
      const c = k?.configs[0];
      expect(presets.some((p) => p.w === c?.w && p.d[c.id] === c.d), `${id}'s default`).toBe(true);
    }
  });

  it("places each kind at each preset's size, height and elevation", () => {
    for (const id of NEW) {
      for (const p of kindOf(id)?.presets ?? []) {
        const { doc, object } = placed(id, p.id);
        const o = doc.objects[object];
        expect([o?.w.standard, o?.d.standard, o?.h.standard], `${id} ${p.id}`).toEqual([p.w, p.d.standard, p.h?.standard]);
        expect(o?.z.standard, `${id} ${p.id}`).toEqual(p.z?.standard ?? 0);
      }
    }
  });

  it("a Poster 50 × 70 frame is 0.53 × 0.03, 0.73 tall, from 1.15", () => {
    const { doc, object } = placed("picture", "Poster");
    const o = doc.objects[object];
    expect([o?.w.standard, o?.d.standard, o?.h.standard, o?.z.standard]).toEqual([0.53, 0.03, 0.73, 1.15]);
  });

  it("the coat stand is round with no front and stands on the floor; the hung pieces have no use zone", () => {
    expect([kindOf("coatStand")?.outline, kindOf("coatStand")?.front, kindOf("coatStand")?.configs[0]?.z]).toEqual(["round", false, 0]);
    for (const id of NEW) if (id !== "coatStand") expect(Object.values(kindOf(id)?.sides ?? {}).some(Boolean), id).toBe(false);
  });
});

describe("the towel rail's presets (step 01, AC-04)", () => {
  it("offers 50 × 80, 50 × 120 and 60 × 150 at 0.15, 50 × 120 its default", () => {
    const presets = kindOf("towelRail")?.presets ?? [];
    expect(presets.map((p) => [p.w, p.h?.standard, p.z?.standard])).toEqual([[0.5, 0.8, 0.15], [0.5, 1.2, 0.15], [0.6, 1.5, 0.15]]);
    const c = kindOf("towelRail")?.configs[0];
    expect([c?.w, c?.h, c?.z]).toEqual([0.5, 1.2, 0.15]);
  });
});

describe("pieces as thin as 2 cm (step 01, AC-02, hangings.03)", () => {
  it("the minimum is 0.02; 0.02 deep places, 0.019 is refused naming 0.02", () => {
    expect(MIN_OBJECT_SIZE).toBe(0.02);
    const { doc, object } = placed("picture");
    const set = (d: number): string => {
      const r = execute(doc, { type: "setObjectSize", objectId: object, w: 0.5, d: { standard: d } });
      return r.ok ? "accepted" : r.error.message;
    };
    expect(set(0.02)).toBe("accepted");
    expect(set(0.019)).toMatch(/0\.02/);
  });
});
