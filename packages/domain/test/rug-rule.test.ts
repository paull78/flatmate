import { describe, expect, it } from "vitest";
import { unwrap, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { OBJECT_KINDS, isRug, kindConfigs, kindOf, type ObjectConfig, type ObjectKind } from "../src/kinds";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { candidateShape, placementFit } from "../src/queries/fit";
import { freeFloor } from "../src/queries/free-floor";
import { footprintQuad } from "../src/queries/footprints";
import { landing } from "../src/queries/landing";
import { levelOf } from "../src/queries/levels";
import { nearestObstacles } from "../src/queries/nearest";
import { pickOrder, placementRange, rangeOf, stackOrder, type Stacked } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// The rug rule (spec "The rug rule"; catalog.08, .15, .24): one predicate, `isRug`, asked by fit, zones and door swings,
// free floor, and the draw and pick orders. Every test holds a fixture that changes the answer: the same footprint,
// 0.01 m high and not a rug, is refused, warned or counted where the rug is not.

const ROOM = (): Document => rectDoc(0, 0, 14, 14); // inner faces 0.1 and 13.9
const CARPET = { w: 5, d: 5 }; // wider than any kind, so an open flight's foot lies over it; x and y 4.5–9.5
const CENTRE: Point = { x: 7, y: 7 };

const run = (doc: Document, ...commands: Command[]): Document => commands.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
/** The anchor (the back edge's middle) of a w × d footprint centred on `c`. */
const backOf = (c: Point, d: number): Point => ({ x: c.x, y: c.y + d / 2 });

/** A room with a 5 × 5, 0.01 m high `kind` centred on (7, 7), its bottom at `bottom`, as the placement "under". */
function withSheet(doc: Document, kind: string, bottom = 0): Document {
  const placed = run(doc, { type: "placeObject", deck: null, opId: "under", state: "s0", object: { kind, size: CARPET }, at: backOf(CENTRE, CARPET.d) });
  return run(placed, { type: "setObjectSize", objectId: "under/o0", w: CARPET.w, d: { standard: CARPET.d }, h: { standard: 0.01 }, z: { standard: bottom } });
}

/** A kind's configuration's bottom, on the floor: a ceiling-hung one's too. */
function bottomOf(c: ObjectConfig): number {
  return rangeOf(ROOM(), { h: c.h, z: c.z }, footprintQuad({ x: 7, y: 7 }, c.w, c.d, 0), null).bottom;
}

const NON_RUGS: readonly ObjectKind[] = OBJECT_KINDS.filter((k) => k.rug !== true);

describe("isRug", () => {
  it("reads the kinds table's flag: the rug and the round rug, no other kind and no unknown one", () => {
    expect(OBJECT_KINDS.filter((k) => isRug(k.id)).map((k) => k.id)).toEqual(["rug", "roundRug"]);
    expect(isRug("nothing")).toBe(false);
    for (const k of OBJECT_KINDS) expect(isRug(k.id), k.id).toBe(k.rug);
  });

  it("the rows: one thin slab, no zone, with the spec's presets", () => {
    const row = (id: string) => kindOf(id);
    expect(kindConfigs("rug")).toEqual([{ id: "standard", label: "Standard", w: 2, d: 1.4, zone: null, h: 0.01, z: 0 }]);
    expect(kindConfigs("roundRug")).toEqual([{ id: "standard", label: "Standard", w: 1.6, d: 1.6, zone: null, h: 0.01, z: 0 }]);
    expect(row("rug")).toMatchObject({ label: "Rug", outline: "rect", semanticClass: "IfcFurnishingElement USERDEFINED", front: false });
    expect(row("roundRug")).toMatchObject({ label: "Round rug", outline: "round", semanticClass: "IfcFurnishingElement USERDEFINED", front: false });
    expect(row("rug")?.presets.map((p) => [p.w, p.d.standard])).toEqual([[1.6, 1.2], [2, 1.4], [2.4, 1.7], [3, 2]]);
    expect(row("roundRug")?.presets.map((p) => [p.w, p.d.standard])).toEqual([[1.2, 1.2], [1.6, 1.6], [2, 2]]);
    for (const id of ["rug", "roundRug"]) {
      expect(row(id)?.sides, id).toEqual({ front: false, back: false, left: false, right: false });
      for (const p of row(id)?.presets ?? []) expect(p.h, `${id} ${p.id}`).toBeUndefined();
    }
  });
});

describe("the rug rule against every kind (catalog.15, .24)", () => {
  for (const k of NON_RUGS) {
    for (const c of k.configs) {
      // Centred on the sheet, and with its centre on the sheet's right edge, so it overlaps only in part.
      for (const [where, at] of [["over", CENTRE], ["across the edge of", { x: 9.5, y: 7 }]] as const) {
        it(`${k.id} (${c.id}) ${where} a rug fits; over a 0.01 m high box of the same footprint it is refused`, () => {
          const bottom = bottomOf(c);
          const candidate = { kind: k.id, state: "s0", at: backOf(at, c.d), rotation: 0, config: c.id, surface: null };
          expect(placementFit(withSheet(ROOM(), "rug", bottom), candidate)).toEqual({ fits: true, reason: null });
          expect(placementFit(withSheet(ROOM(), "roundRug", bottom), { ...candidate, at: backOf({ x: 7, y: 7 }, c.d) })).toEqual({ fits: true, reason: null });
          expect(placementFit(withSheet(ROOM(), "block", bottom), candidate)).toEqual({ fits: false, reason: "object" });
        });
      }

      it(`${k.id} (${c.id}): the command agrees with the fit, the rug laid first or second`, () => {
        const bottom = bottomOf(c);
        const piece: Command = { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: k.id }, at: backOf(CENTRE, c.d), config: c.id };
        const onTop = run(withSheet(ROOM(), "rug", bottom), piece);
        expect(validateDocument(onTop).ok).toBe(true);
        expect(validateDocument(withSheet(run(ROOM(), piece), "rug", bottom)).ok).toBe(true);
        expect(execute(withSheet(ROOM(), "block", bottom), piece).ok).toBe(false);
      });
    }
  }

  it("two rugs overlap each other", () => {
    const doc = withSheet(ROOM(), "rug");
    expect(placementFit(doc, { kind: "roundRug", state: "s0", at: backOf(CENTRE, 1.6), rotation: 0, config: "standard", surface: null })).toEqual({ fits: true, reason: null });
  });

  it("moving a piece onto a rug and a rug under a piece both commit", () => {
    const room = run(ROOM(),
      { type: "placeObject", deck: null, opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 3, y: 12 } },
      { type: "placeObject", deck: null, opId: "rug", state: "s0", object: { kind: "rug" }, at: { x: 10, y: 3 } });
    const sofa = run(room, { type: "movePlacement", placementId: "sofa/p0", at: { x: 10, y: 3 }, rotation: 0 });
    expect(sofa.placements["sofa/p0"]?.at).toEqual({ x: 10, y: 3 });
    const rug = run(room, { type: "movePlacement", placementId: "rug/p0", at: { x: 3, y: 12 }, rotation: 0 });
    expect(rug.placements["rug/p0"]?.at).toEqual({ x: 3, y: 12 });
  });

  it("a rug grown under a piece still overlaps it freely; a box grown the same way is refused", () => {
    const grow: Command = { type: "setObjectSize", objectId: "a/o0", w: 4, d: { standard: 4 } };
    const room = (kind: string): Document => run(ROOM(),
      { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind, size: { w: 1, d: 1 } }, at: { x: 3, y: 12 } },
      { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "sofa" }, at: { x: 3, y: 10.5 } });
    expect(execute(room("rug"), grow).ok).toBe(true);
    expect(execute(room("block"), grow).ok).toBe(false);
  });
});

describe("a rug still lies inside one room and off the walls (I10)", () => {
  const twoRooms = (): Document => run(rectDoc(0, 0, 8, 6), { type: "addWall", opId: "mid", from: { at: { x: 4, y: 0 } }, to: { at: { x: 4, y: 6 } } });
  const rug = (at: Point, surface: string | null = null) => ({ kind: "rug", state: "s0", at, rotation: 0, config: "standard", surface });

  it("a rug crossing a wall is refused", () => {
    expect(placementFit(twoRooms(), rug({ x: 4, y: 4 }))).toEqual({ fits: false, reason: "wall" });
    expect(execute(twoRooms(), { type: "placeObject", deck: null, opId: "r", state: "s0", object: { kind: "rug" }, at: { x: 4, y: 4 } }).ok).toBe(false);
  });

  it("a rug outside any room, or leaving its room, is refused", () => {
    expect(placementFit(twoRooms(), rug({ x: 20, y: 20 }))).toEqual({ fits: false, reason: "room" });
    expect(placementFit(twoRooms(), rug({ x: 0.5, y: 4 })).fits).toBe(false);
    expect(placementFit(twoRooms(), rug({ x: 2, y: 4 }))).toEqual({ fits: true, reason: null });
  });

  it("a rug crossing a column is refused", () => {
    const doc = run(rectDoc(0, 0, 8, 6), { type: "placeColumn", opId: "c", at: { x: 4, y: 3 }, width: 0.4, depth: 0.4 });
    expect(placementFit(doc, rug({ x: 4, y: 3.7 }))).toEqual({ fits: false, reason: "wall" });
  });
});

describe("zones and door swings (catalog.15)", () => {
  /** A piece of `owner`, its back on y 13.9, and a sheet of `kind` across one of its zones. */
  const zoneAnd = (kind: string, owner: string, sheetAt: Point, size: { w: number; d: number }): Document => run(ROOM(),
    { type: "placeObject", deck: null, opId: "owner", state: "s0", object: { kind: owner }, at: { x: 7, y: 13.9 } },
    { type: "placeObject", deck: null, opId: "sheet", state: "s0", object: { kind, size }, at: sheetAt });
  // A cot's front zone is below its front edge, y 12.64; a bed's zones are on its left and right: its left, x 5.55–6.15.
  const CASES = [["a cot's front zone", "cot", { x: 7, y: 12.5 }, { w: 2, d: 1 }], ["a bed's left zone", "bed", { x: 5.2, y: 12.8 }, { w: 1.4, d: 1 }]] as const;

  /** A door on the bottom wall opening into the room, a 2 × 2 sheet of `kind` over its swing. */
  const doorAnd = (kind: string): Document => {
    const room = ROOM();
    const wall = Object.values(room.walls).find((w) => room.joints[w.a]?.y === 0 && room.joints[w.b]?.y === 0)?.id ?? "";
    return run(room,
      { type: "addOpening", opId: "door", wall, kind: "swing", offset: 3, width: 0.9 },
      { type: "placeObject", deck: null, opId: "sheet", state: "s0", object: { kind, size: { w: 2, d: 2 } }, at: { x: 3.5, y: 2.1 } });
  };
  const sheet = (doc: Document, id: string): Document => run(doc, { type: "setObjectSize", objectId: `${id}/o0`, w: doc.objects[`${id}/o0`]?.w.standard ?? 0, d: { standard: doc.objects[`${id}/o0`]?.d.standard ?? 0 }, h: { standard: 0.01 } });

  for (const [name, owner, at, size] of CASES) {
    it(`a rug in ${name} blocks nothing; a 0.01 m high box there does`, () => {
      expect(clearanceWarnings(zoneAnd("rug", owner, at, size), "s0")).toEqual([]);
      expect(clearanceWarnings(sheet(zoneAnd("block", owner, at, size), "sheet"), "s0").map((w) => w.against.id)).toEqual(["sheet/p0"]);
    });
  }

  it("a rug under a door swing blocks nothing; a 0.01 m high box there does", () => {
    expect(clearanceWarnings(doorAnd("rug"), "s0")).toEqual([]);
    expect(clearanceWarnings(sheet(doorAnd("block"), "sheet"), "s0").map((w) => w.zone.table)).toEqual(["openings"]);
  });

  it("a rug owns no zone, whatever is on it", () => {
    const doc = run(withSheet(ROOM(), "rug"), { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "sofa" }, at: backOf(CENTRE, 0.9) });
    expect(clearanceWarnings(doc, "s0").filter((w) => w.zone.id === "under/p0")).toEqual([]);
  });
});

describe("free floor (catalog.15)", () => {
  const free = (doc: Document): number[] => [...freeFloor(doc, "s0").values()].map((v) => v ?? Number.NaN);
  const sofa: Command = { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "sofa" }, at: backOf(CENTRE, 0.9) };

  it("a rug takes none: with a rug it equals without, a piece on it or not; a 0.01 m high box takes its area", () => {
    expect(free(withSheet(ROOM(), "rug"))).toEqual(free(ROOM()));
    expect(free(run(withSheet(ROOM(), "rug"), sofa))).toEqual(free(run(ROOM(), sofa)));
    expect(free(withSheet(ROOM(), "block"))[0]).toBeCloseTo((free(ROOM())[0] ?? 0) - 25, 6);
  });
});

describe("the stacking orders (catalog.15, seating.28)", () => {
  const at = (id: string, bottom: number, more: Partial<Stacked> = {}): Stacked => ({ id, range: { bottom, top: bottom + 0.5 }, ...more });
  const rug = (id: string, bottom = 0): Stacked => ({ id, range: { bottom, top: bottom + 0.01 }, rug: true });
  const order = (items: Stacked[], by: (a: Stacked, b: Stacked) => number): string[] => [...items].sort(by).map((x) => x.id);

  it("stackOrder puts a rug before a sofa standing on it; pickOrder after, whichever ID comes first", () => {
    for (const [r, s] of [["a", "b"], ["b", "a"]] as const) {
      expect(order([at(s, 0), rug(r)], stackOrder)).toEqual([r, s]);
      expect(order([rug(r), at(s, 0)], stackOrder)).toEqual([r, s]);
      expect(order([rug(r), at(s, 0)], pickOrder)).toEqual([s, r]);
      expect(order([at(s, 0), rug(r)], pickOrder)).toEqual([s, r]);
    }
  });

  it("a rug draws before every piece and picks after every piece: a seat, a stair, one above the cut, whatever its bottom", () => {
    const items = [at("seat", 0, { seat: true }), at("stair", 0, { stair: true }), at("cabinet", 1.4), rug("z", 0.45), at("table", 0)];
    expect(order(items, stackOrder)[0]).toBe("z");
    expect(order(items, pickOrder).at(-1)).toBe("z");
  });

  it("the others keep their orders around it", () => {
    const items = [at("seat", 0, { seat: true }), at("table", 0), rug("z")];
    expect(order(items, stackOrder)).toEqual(["z", "seat", "table"]);
    expect(order(items, pickOrder)).toEqual(["table", "seat", "z"]);
  });
});

describe("live distances (catalog.15)", () => {
  it("measure past a rug to the wall, and stop at a 0.01 m high box", () => {
    const quad = footprintQuad({ x: 2, y: 8 }, 1, 1, 0); // x 1.5–2.5, y 7–8, left of the sheet's left edge x 4.5
    const gap = (kind: string): number | undefined => nearestObstacles(withSheet(ROOM(), kind), quad, "s0", new Set()).right?.gap;
    expect(gap("block")).toBeCloseTo(2, 6);
    expect(gap("rug")).toBeCloseTo(11.4, 6); // x 2.5 to the right wall's face 13.9
  });
});

describe("a rug and the other rules", () => {
  it("a chair on a rug still tucks under a desk on the rug, and still can't stand on the desk", () => {
    // The desk: y 6.9–7.5. A chair turned to face it: its back edge at `y`, its seat reaching 0.5 up.
    const desk = run(withSheet(ROOM(), "rug"), { type: "placeObject", deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 7, y: 7.5 } });
    const chair = (y: number) => ({ kind: "chair", state: "s0", at: { x: 7, y }, rotation: 180, config: "standard", surface: null });
    expect(placementFit(desk, chair(6.75))).toEqual({ fits: true, reason: null }); // all but its back 0.10 may go under
    expect(placementFit(desk, chair(6.95))).toEqual({ fits: false, reason: "object" }); // its back strip under the desk
  });

  it("a rug tucks nothing: a chair on a rug is whole against a piece beside it", () => {
    const sofa = run(withSheet(ROOM(), "rug"), { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "sofa" }, at: { x: 7, y: 7.5 } });
    expect(placementFit(sofa, { kind: "chair", state: "s0", at: { x: 7, y: 7 }, rotation: 0, config: "standard", surface: null })).toEqual({ fits: false, reason: "object" });
  });

  it("a rug is 0.01 m thick and stands on the floor", () => {
    const doc = withSheet(ROOM(), "rug");
    const range = placementRange(doc, "under/p0");
    expect(range?.bottom).toBe(0);
    expect(range?.top).toBeCloseTo(0.01, 9);
  });

  describe("on a deck: the landing rule, like any piece", () => {
    const platform = (): Document => run(ROOM(), { type: "addDeck", opId: "deck", preset: "platform", at: { x: 7, y: 7 }, w: 4, d: 4 });
    const id = "deck/k0";
    const lands = (doc: Document, kind: string, at: Point, w: number, d: number, current: string | null | undefined) => {
      const { ring, parts, centre, rug } = candidateShape(kind, at, w, d, 0);
      return landing(doc, { state: "s0", ring, parts, heights: { h: 0.01, z: 0 }, current, ignore: [], centre, rug }, levelOf(doc, null));
    };

    it("a rug put over a platform lands on it, and is refused on the floor there", () => {
      const doc = platform();
      expect(lands(doc, "rug", backOf(CENTRE, 1.4), 2, 1.4, undefined)).toEqual({ kind: "surface", deck: id });
      expect(placementFit(doc, { kind: "rug", state: "s0", at: backOf(CENTRE, 1.4), rotation: 0, config: "standard", surface: null })).toEqual({ fits: false, reason: "deck" });
      const on = run(doc, { type: "placeObject", deck: id, opId: "r", state: "s0", object: { kind: "rug" }, at: backOf(CENTRE, 1.4) });
      expect(placementRange(on, "r/p0")?.bottom).toBeCloseTo(0.45, 9);
    });

    it("a sofa stands on a rug on a platform, and the rug reaches at most 0.30 m past the deck (steps.06)", () => {
      const on = run(platform(), { type: "placeObject", deck: id, opId: "r", state: "s0", object: { kind: "rug" }, at: backOf(CENTRE, 1.4) });
      const sofa = { kind: "sofa", state: "s0", at: backOf(CENTRE, 0.9), rotation: 0, config: "standard", surface: id };
      expect(placementFit(on, sofa)).toEqual({ fits: true, reason: null });
      expect(placementFit(platform(), { kind: "rug", state: "s0", at: { x: 8.8, y: 7.7 }, rotation: 0, config: "standard", surface: id })).toEqual({ fits: false, reason: "deckReach" });
    });
  });
});
