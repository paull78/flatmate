import { describe, expect, it } from "vitest";
import {
  applyStoredPatch,
  buildExpectations,
  canonicalJson,
  emptyStored,
  emptyVersions,
  failedExpectations,
  isTableName,
  keyOf,
  patchWrites,
  stampVersions,
  TABLE_NAMES,
  uniqueKeys,
  type Patch,
} from "../src/patch";

const j1 = { id: "j1", x: 0, y: 0 };
const j2 = { id: "j2", x: 6, y: 0 };
const w1 = { id: "w1", a: "j1", b: "j2" };

describe("keys", () => {
  it("keyOf joins table and id", () => {
    expect(keyOf({ table: "walls", id: "w1" })).toBe("walls/w1");
  });

  it("isTableName accepts the seventeen tables only (layout-states adds states, objects, placements, openings; dims adds dimensions; sheet adds projectFields; import adds underlays; heights adds ceilings; decks adds decks; stairwell adds deckHoles)", () => {
    for (const t of ["joints", "walls", "zoneLabels", "decks", "deckHoles", "states", "objects", "placements", "openings", "dimensions", "projectFields", "underlays", "logos", "ceilings", "sheets", "sections", "areas"]) expect(isTableName(t)).toBe(true);
    expect(TABLE_NAMES).toEqual(["joints", "walls", "zoneLabels", "decks", "deckHoles", "states", "objects", "placements", "openings", "dimensions", "projectFields", "underlays", "logos", "ceilings", "sheets", "sections", "areas"]);
    expect(isTableName("furniture")).toBe(false);
    expect(isTableName(3)).toBe(false);
  });

  it("uniqueKeys keeps the first occurrence, in order, as bare keys", () => {
    const keys = uniqueKeys([
      { table: "walls", id: "w1" },
      { table: "joints", id: "j1" },
      { table: "walls", id: "w1" },
    ]);
    expect(keys).toEqual([
      { table: "walls", id: "w1" },
      { table: "joints", id: "j1" },
    ]);
  });

  it("patchWrites lists puts then deletes without duplicates", () => {
    const p: Patch = {
      puts: [{ table: "joints", entity: j1 }, { table: "joints", entity: j1 }],
      deletes: [{ table: "walls", id: "w9" }],
    };
    expect(patchWrites(p)).toEqual([
      { table: "joints", id: "j1" },
      { table: "walls", id: "w9" },
    ]);
  });
});

describe("applyStoredPatch", () => {
  it("applies puts and deletes without mutating the input", () => {
    const before = applyStoredPatch(emptyStored(), {
      puts: [{ table: "joints", entity: j1 }, { table: "joints", entity: j2 }, { table: "walls", entity: w1 }],
      deletes: [],
    });
    const snapshot = JSON.stringify(before);

    const after = applyStoredPatch(before, {
      puts: [{ table: "joints", entity: { id: "j2", x: 6, y: 1 } }],
      deletes: [{ table: "walls", id: "w1" }],
    });

    expect(after.joints["j2"]).toEqual({ id: "j2", x: 6, y: 1 });
    expect(after.walls["w1"]).toBeUndefined();
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("versions", () => {
  it("stampVersions stamps puts and keeps deleted IDs as tombstones", () => {
    const v1 = stampVersions(emptyVersions(), { puts: [{ table: "walls", entity: w1 }], deletes: [] }, "c1");
    const v2 = stampVersions(v1, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "c2");
    expect(v1.walls["w1"]).toBe("c1");
    expect(v2.walls["w1"]).toBe("c2");
    expect(v1.walls["w1"]).toBe("c1");
  });

  it("buildExpectations gives null for never-existed IDs and dedupes keys", () => {
    const v = stampVersions(emptyVersions(), { puts: [{ table: "joints", entity: j1 }], deletes: [] }, "c1");
    expect(
      buildExpectations(v, [
        { table: "joints", id: "j1" },
        { table: "joints", id: "j7" },
        { table: "joints", id: "j1" },
      ]),
    ).toEqual([
      { table: "joints", id: "j1", lastCs: "c1" },
      { table: "joints", id: "j7", lastCs: null },
    ]);
  });

  it("failedExpectations lists keys whose version moved", () => {
    const v = stampVersions(emptyVersions(), { puts: [{ table: "joints", entity: j1 }], deletes: [] }, "c2");
    expect(
      failedExpectations(v, [
        { table: "joints", id: "j1", lastCs: "c1" },
        { table: "joints", id: "j5", lastCs: null },
      ]),
    ).toEqual([{ table: "joints", id: "j1" }]);
    expect(failedExpectations(v, [{ table: "joints", id: "j1", lastCs: "c2" }])).toEqual([]);
  });

  it("a delete-recreate-delete sequence never returns to an old version (no ABA)", () => {
    let v = emptyVersions();
    v = stampVersions(v, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "d1");
    v = stampVersions(v, { puts: [{ table: "walls", entity: w1 }], deletes: [] }, "r1");
    v = stampVersions(v, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "d2");
    expect(failedExpectations(v, [{ table: "walls", id: "w1", lastCs: "d1" }])).toEqual([{ table: "walls", id: "w1" }]);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });

  it("gives equal strings for equal values built in different key orders", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("drops undefined object fields like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("layout tables (layout-states.39)", () => {
  it("applyStoredPatch and stampVersions handle puts and deletes in states, objects, placements and openings", () => {
    const s0 = { id: "s0", name: "Layout", order: 0 };
    const o0 = { id: "o0", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 } };
    const p0 = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 1 }, rotation: 0, config: "standard" };
    const d0 = { id: "d0", wall: "w1", kind: "swing", offset: 1, width: 0.8, side: "left", hinge: "a", glazed: false };
    const put: Patch = {
      puts: [
        { table: "states", entity: s0 },
        { table: "objects", entity: o0 },
        { table: "placements", entity: p0 },
        { table: "openings", entity: d0 },
      ],
      deletes: [],
    };
    const doc = applyStoredPatch(emptyStored(), put);
    expect(doc.states).toEqual({ s0 });
    expect(doc.objects).toEqual({ o0 });
    expect(doc.placements).toEqual({ p0 });
    expect(doc.openings).toEqual({ d0 });
    const v = stampVersions(emptyVersions(), put, "c1");
    expect([v.states.s0, v.objects.o0, v.placements.p0, v.openings.d0]).toEqual(["c1", "c1", "c1", "c1"]);
    const del: Patch = { puts: [], deletes: [{ table: "placements", id: "p0" }, { table: "openings", id: "d0" }] };
    const after = applyStoredPatch(doc, del);
    expect(after.placements).toEqual({});
    expect(after.openings).toEqual({});
    expect(stampVersions(v, del, "c2").placements).toEqual({ p0: "c2" });
  });
});

