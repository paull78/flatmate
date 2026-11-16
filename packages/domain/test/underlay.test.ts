import { describe, expect, it } from "vitest";
import { MAX_UNDERLAY_DATA_CHARS, emptyStored, parseStoredDocument, unwrap, validateChangeset, type EntityKey, type EntityValue, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { scaleUnderlay } from "../src/commands/underlay";
import type { Command } from "../src/commands/types";
import { MESSAGES, invariantsMessage, topologyMessage } from "../src/errors";
import type { Document, Underlay } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { deserialize, serialize } from "../src/serialize";
import { parseUnderlay } from "../src/shape";
import { underlayRect } from "../src/underlay";
import { validateDocument } from "../src/validate";
import { rectDoc, rng } from "./helpers";

// The plan underlay (import): one row under the fixed id "underlay", placed, scaled about a point and removed by three
// commands. Positions are off the grid and the picture is not square, so a swapped width and height or a y flip shows.

const room = rectDoc(0, 0, 3.2, 2);
const place = {
  type: "placeUnderlay", pictureId: "pic-1", data: "/9j/4AAQSkZJRg", width: 1600, height: 900, at: { x: -3.25, y: 7.5 },
} satisfies Command;
const placed = unwrap(execute(room, place)).doc;
const A = { x: 1.37, y: 2.11 }; // picture pixel (462, 539) under `placed`
const key: EntityKey = { table: "underlays", id: "underlay" };

const scale = (a: Point, b: Point, distance: number): Command => ({ type: "scaleUnderlay", a, b, distance });
const remove: Command = { type: "removeUnderlay" };
const row = (doc: Document): Underlay => {
  const u = doc.underlays.underlay;
  if (!u) throw new Error("no underlay");
  return u;
};
const pixel = (u: Underlay, p: Point): Point => ({ x: (p.x - u.at.x) / u.metresPerPixel, y: (u.at.y - p.y) / u.metresPerPixel });

function refusal(doc: Document, cmd: Command) {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : { kind: r.error.kind, message: r.error.message };
}
function withRow(u: Underlay, doc: Document = room): Document {
  return { ...doc, underlays: { [u.id]: u } };
}
const invariants = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.invariant);
};
const good = row(placed);

describe("underlayRect", () => {
  it("is null without an underlay", () => {
    expect(underlayRect(room)).toBeNull();
  });

  it("spans width·mpp right and height·mpp down (toward −y) from at", () => {
    const r = underlayRect(placed);
    if (!r) throw new Error("no rect");
    expect(r.minX).toBeCloseTo(-3.25, 9);
    expect(r.maxX).toBeCloseTo(12.75, 9);
    expect(r.maxY).toBeCloseTo(7.5, 9);
    expect(r.minY).toBeCloseTo(-1.5, 9);
  });

  it("a picture taller than wide", () => {
    const r = underlayRect(withRow({ ...good, width: 600, height: 1800, at: { x: 0.4, y: -0.6 } }));
    if (!r) throw new Error("no rect");
    expect(r.minX).toBeCloseTo(0.4, 9);
    expect(r.maxX).toBeCloseTo(6.4, 9);
    expect(r.maxY).toBeCloseTo(-0.6, 9);
    expect(r.minY).toBeCloseTo(-18.6, 9);
  });
});

describe("placeUnderlay", () => {
  it("stores the fixed-id row, JPEG, provisional 0.01 m/px, unscaled", () => {
    const r = unwrap(execute(room, place));
    expect(r.doc.underlays).toEqual({
      underlay: {
        id: "underlay", pictureId: "pic-1", mime: "image/jpeg", data: place.data, width: 1600, height: 900,
        at: { x: -3.25, y: 7.5 }, metresPerPixel: 0.01, scaled: false,
      },
    });
    expect(r.patch.puts.map((p) => ({ table: p.table, id: p.entity.id }))).toEqual([key]);
    expect(r.patch.deletes).toEqual([]);
    expect(r.patch.dependencies).toEqual([key]);
    expect(r.doc.walls).toBe(room.walls);
    expect(r.doc.joints).toBe(room.joints);
  });

  const scaled = unwrap(execute(placed, scale(A, { x: A.x + 3, y: A.y + 4 }, 10))).doc;
  const second = {
    type: "placeUnderlay", pictureId: "pic-2", data: "/9j/BBBB", width: 1200, height: 1800, at: { x: 0.5, y: -1.25 },
  } satisfies Command;

  it("replaces the row in one put and resets scale and position (AC-06)", () => {
    const r = unwrap(execute(scaled, second));
    expect(row(r.doc)).toEqual({
      id: "underlay", pictureId: "pic-2", mime: "image/jpeg", data: "/9j/BBBB", width: 1200, height: 1800,
      at: { x: 0.5, y: -1.25 }, metresPerPixel: 0.01, scaled: false,
    });
    expect(r.patch.puts).toHaveLength(1);
    expect(r.patch.deletes).toEqual([]);
    expect(Object.keys(r.doc.underlays)).toEqual(["underlay"]);
  });

  it("undo of a replace brings back the first picture with its scale (AC-06)", () => {
    const r = unwrap(execute(scaled, second));
    expect(applyPatch(r.doc, invertPatch(r.patch))).toEqual({ ok: true, value: scaled });
  });

  it("accepts data of exactly MAX_UNDERLAY_DATA_CHARS and a 2000 px long side (AC-02)", () => {
    const r = execute(room, { ...place, data: "A".repeat(MAX_UNDERLAY_DATA_CHARS), width: 2000, height: 1 });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["no data", { data: "" }],
    ["data over the cap", { data: "A".repeat(MAX_UNDERLAY_DATA_CHARS + 1) }],
    ["width 2001", { width: 2001 }],
    ["width 1.5", { width: 1.5 }],
    ["height 0", { height: 0 }],
    ["height -900", { height: -900 }],
  ])("refuses a row outside the limits: %s", (_, change) => {
    const before = JSON.stringify(room);
    expect(refusal(room, { ...place, ...change })).toEqual({ kind: "invalid", message: MESSAGES.underlay });
    expect(JSON.stringify(room)).toBe(before);
  });

  it("refuses a non-finite position", () => {
    const before = JSON.stringify(room);
    expect(execute(room, { ...place, at: { x: NaN, y: 0 } }).ok).toBe(false);
    expect(JSON.stringify(room)).toBe(before);
  });
});

describe("scaleUnderlay", () => {
  it("400 picture pixels typed as 5 m gives 0.0125 m/px and scaled (AC-03)", () => {
    const r = unwrap(execute(placed, scale(A, { x: A.x + 2.4, y: A.y - 3.2 }, 5)));
    const u = row(r.doc);
    expect(u.metresPerPixel).toBeCloseTo(0.0125, 12);
    expect(u.scaled).toBe(true);
    const p = pixel(u, A);
    expect(p.x).toBeCloseTo(462, 9);
    expect(p.y).toBeCloseTo(539, 9);
    expect(r.doc.walls).toBe(placed.walls);
    expect(r.doc.joints).toBe(placed.joints);
  });

  it("points 5 m apart and distance 10 double the scale about the first point (AC-09)", () => {
    const u = row(unwrap(execute(placed, scale(A, { x: A.x + 3, y: A.y + 4 }, 10))).doc);
    expect(u.metresPerPixel).toBeCloseTo(0.02, 9);
    expect(u.at.x).toBeCloseTo(-7.87, 9);
    expect(u.at.y).toBeCloseTo(12.89, 9);
    expect({ pictureId: u.pictureId, data: u.data, width: u.width, height: u.height }).toEqual({
      pictureId: "pic-1", data: place.data, width: 1600, height: 900,
    });
  });

  it("undo restores the previous scale (AC-03)", () => {
    const r = unwrap(execute(placed, scale(A, { x: A.x + 3, y: A.y + 4 }, 10)));
    expect(applyPatch(r.doc, invertPatch(r.patch))).toEqual({ ok: true, value: placed });
  });

  it("same input, same row (AC-09)", () => {
    const cmd = scale(A, { x: A.x + 2.4, y: A.y - 3.2 }, 5);
    expect(row(unwrap(execute(placed, cmd)).doc)).toEqual(row(unwrap(execute(placed, cmd)).doc));
  });

  // Dyadic points, so a + (at − a)·1 is exactly at.
  const a = { x: 0.5, y: 0.25 };
  const b = { x: 3.5, y: 4.25 };
  const byOne = unwrap(execute(placed, scale(a, b, Math.hypot(b.x - a.x, b.y - a.y))));

  it("an unscaled row scaled by 1 still sets scaled", () => {
    expect(byOne.patch.puts).toHaveLength(1);
    expect(row(byOne.doc)).toEqual({ ...good, scaled: true });
  });

  it("a no-op on a scaled row returns the input doc and an empty patch", () => {
    // Called directly: execute returns its input for any empty patch, which would hide a missing shortcut.
    const r = unwrap(scaleUnderlay(byOne.doc, { type: "scaleUnderlay", a, b, distance: Math.hypot(b.x - a.x, b.y - a.y) }));
    expect(r.doc).toBe(byOne.doc);
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.deletes).toEqual([]);
  });

  it.each([
    ["no underlay", room, scale(A, { x: 2, y: 2 }, 1), "notFound", "Underlay not found"],
    ["coincident points", placed, scale(A, A, 1), "invalidInput", "Scale points must be apart"],
    ["points 1e-10 apart", placed, scale(A, { x: A.x + 1e-10, y: A.y }, 1), "invalidInput", "Scale points must be apart"],
    ["a non-finite point", placed, scale({ x: NaN, y: 0 }, A, 1), "invalidInput", "Invalid scale points"],
    ["distance 0", placed, scale(A, { x: 2, y: 2 }, 0), "invalidInput", "Distance must be more than 0"],
    ["distance -5", placed, scale(A, { x: 2, y: 2 }, -5), "invalidInput", "Distance must be more than 0"],
    ["distance NaN", placed, scale(A, { x: 2, y: 2 }, NaN), "invalidInput", "Distance must be more than 0"],
    ["distance Infinity", placed, scale(A, { x: 2, y: 2 }, Infinity), "invalidInput", "Distance must be more than 0"],
    ["points whose distance overflows", placed, scale({ x: -1e308, y: 0 }, { x: 1e308, y: 0 }, 1), "invalidInput", "Invalid scale points"],
    ["a scale that overflows", placed, scale({ x: 0, y: 0 }, { x: 1e-8, y: 0 }, 1e305), "invalidInput", "Scale out of range"],
    ["a scale that underflows", placed, scale({ x: 1, y: 1 }, { x: 21, y: 1 }, 1e-320), "invalidInput", "Scale out of range"],
  ])("refusals (AC-09): %s", (_, doc, cmd, kind, message) => {
    expect(refusal(doc, cmd)).toEqual({ kind, message });
  });

  it("seeded fuzz: a stays fixed and the rect scales by distance/len", () => {
    const seed = 20261016;
    const next = rng(seed);
    const between = (lo: number, hi: number): number => lo + (hi - lo) * next();
    const whole = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
    // Relative within 1e-9 of the largest operand: a difference of two large coordinates keeps only their precision.
    const near = (actual: number, expected: number, ...operands: number[]): boolean =>
      Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected), ...operands.map(Math.abs));
    for (let i = 0; i < 500; i++) {
      const u: Underlay = {
        ...good, at: { x: between(-1000, 1000), y: between(-1000, 1000) }, metresPerPixel: between(1e-4, 1),
        width: whole(1, 2000), height: whole(1, 2000), scaled: next() < 0.5,
      };
      const p = { x: between(-1000, 1000), y: between(-1000, 1000) };
      let q = { x: between(-1000, 1000), y: between(-1000, 1000) };
      while (Math.hypot(q.x - p.x, q.y - p.y) < 1e-3) q = { x: between(-1000, 1000), y: between(-1000, 1000) };
      const distance = between(1e-3, 1000);
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const k = distance / len;
      const doc = withRow(u);
      const where = `seed ${seed} case ${i}`;
      const r = execute(doc, scale(p, q, distance));
      if (!r.ok) throw new Error(`${where}: ${r.error.message}`);
      const v = row(r.value.doc);
      const before = pixel(u, p);
      const after = pixel(v, p);
      const m = v.metresPerPixel;
      expect(near(after.x, before.x, p.x / m, v.at.x / m), `${where} (1) x`).toBe(true);
      expect(near(after.y, before.y, p.y / m, v.at.y / m), `${where} (1) y`).toBe(true);
      const r0 = underlayRect(doc);
      const r1 = underlayRect(r.value.doc);
      if (!r0 || !r1) throw new Error(`${where}: no rect`);
      expect(near(r1.maxX - r1.minX, (r0.maxX - r0.minX) * k, r1.minX, r1.maxX), `${where} (2) width`).toBe(true);
      expect(near(r1.maxY - r1.minY, (r0.maxY - r0.minY) * k, r1.minY, r1.maxY), `${where} (2) height`).toBe(true);
      const qPixel = pixel(u, q);
      const qNow = { x: v.at.x + qPixel.x * m, y: v.at.y - qPixel.y * m };
      expect(near(Math.hypot(qNow.x - p.x, qNow.y - p.y), distance, v.at.x, v.at.y, qNow.x, qNow.y, p.x, p.y), `${where} (3)`).toBe(true);
      expect(v.scaled, `${where} (4)`).toBe(true);
      expect(r.value.patch.dependencies, `${where} (5)`).toEqual([key]);
    }
  });
});

describe("removeUnderlay", () => {
  it("deletes the row and undo brings it back (AC-06)", () => {
    const r = unwrap(execute(placed, remove));
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.deletes).toEqual([key]);
    expect(r.patch.dependencies).toEqual([key]);
    expect(r.doc.underlays).toEqual({});
    expect(applyPatch(r.doc, invertPatch(r.patch))).toEqual({ ok: true, value: placed });
    expect(refusal(room, remove)).toEqual({ kind: "notFound", message: "Underlay not found" });
  });
});

describe("deleteEntities", () => {
  it("refuses the underlay", () => {
    expect(refusal(placed, { type: "deleteEntities", ids: [key] })).toEqual({
      kind: "invalidInput", message: "The underlay is removed with its own command",
    });
  });
});

describe("I16", () => {
  it("a row under another id is refused, so a project never holds two underlays (AC-06)", () => {
    const other = { ...good, id: "u2" };
    expect(invariants(withRow(other))).toContain("I16");
    const v = validateDocument(withRow(other));
    expect(v.ok ? [] : v.error.filter((x) => x.invariant === "I16").map((x) => x.entities)).toEqual([[{ table: "underlays", id: "u2" }]]);
    const both = unwrap(applyPatch(placed, { puts: [{ table: "underlays", entity: other }], deletes: [] }));
    const w = validateDocument(both);
    expect(w.ok ? [] : w.error.filter((x) => x.invariant === "I16").flatMap((x) => x.entities)).toEqual([{ table: "underlays", id: "u2" }]);
  });

  it.each([
    ["mime image/png", { mime: "image/png" }, "I16"],
    ["no data", { data: "" }, "I16"],
    ["data over the cap", { data: "A".repeat(MAX_UNDERLAY_DATA_CHARS + 1) }, "I16"],
    ["width 0", { width: 0 }, "I16"],
    ["width 2001", { width: 2001 }, "I16"],
    ["height 2.5", { height: 2.5 }, "I16"],
    ["metresPerPixel 0", { metresPerPixel: 0 }, "I16"],
    ["metresPerPixel -0.01", { metresPerPixel: -0.01 }, "I16"],
    ["metresPerPixel Infinity", { metresPerPixel: Infinity }, "I8"], // parseUnderlay refuses it first
    ["a scale so small the rect has no size", { metresPerPixel: 5e-324 }, "I16"],
    ["a scale so large the rect overflows", { metresPerPixel: 1e306 }, "I16"],
    ["a position so large the rect has no width", { at: { x: 1.7e308, y: 0 } }, "I16"],
  ])("checks each field: %s", (_, change, invariant) => {
    expect(invariants(withRow({ ...good, ...change }))).toEqual([invariant]);
  });

  it("the good row passes", () => {
    expect(invariants(placed)).toEqual([]);
  });

  it("messages name the id only, never row values (AC-10 groundwork)", () => {
    const v = validateDocument(withRow({ ...good, mime: "image/MARKERX", data: "MARKERY".repeat(3) }));
    const messages = v.ok ? [] : v.error.filter((x) => x.invariant === "I16").map((x) => x.message);
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).toContain("underlay");
      expect(m).not.toContain("MARKERX");
      expect(m).not.toContain("MARKERY");
    }
  });

  it("the toast", () => {
    const v = validateDocument(withRow({ ...good, width: 0 }));
    expect(topologyMessage(v.ok ? [] : v.error)).toBe(MESSAGES.underlay);
    expect(invariantsMessage(new Set(["I16"]))).toBe(MESSAGES.underlay);
  });
});

describe("performance guard", () => {
  it("an unrelated command keeps the underlay row by identity", () => {
    const big: Underlay = { ...good, data: "A".repeat(870_000) };
    const doc = withRow(big);
    const commands: Command[] = [
      { type: "addWall", opId: "w", from: { at: { x: 0.37, y: 0.41 } }, to: { at: { x: 2.93, y: 0.41 } } },
      { type: "setProjectField", key: "client", value: "Rossi" },
    ];
    for (const cmd of commands) {
      const r = unwrap(execute(doc, cmd));
      expect(r.doc.underlays.underlay).toBe(big);
      expect(r.patch.puts.length + r.patch.deletes.length).toBeGreaterThan(0);
      expect(r.patch.puts.some((p) => p.table === "underlays")).toBe(false);
      expect(r.patch.deletes.some((d) => d.table === "underlays")).toBe(false);
      expect(r.patch.before.some((b) => b.table === "underlays")).toBe(false);
      expect(unwrap(applyPatch(doc, r.patch)).underlays.underlay).toBe(big);
    }
  });
});

describe("shape", () => {
  it("parseUnderlay accepts the good row", () => {
    expect(parseUnderlay(good)).toEqual(good);
  });

  it.each([
    ["an extra key", { ...good, picture: {} }],
    ["a missing scaled", (({ scaled: _, ...rest }) => rest)(good)],
    ["scaled as a string", { ...good, scaled: "true" }],
    ["width as a string", { ...good, width: "1600" }],
    ["a nested at", { ...good, at: { x: { v: 1 }, y: 0 } }],
    ["at with an extra key", { ...good, at: { x: 1, y: 0, z: 0 } }],
    ["id constructor", { ...good, id: "constructor" }],
  ])("parseUnderlay refuses %s", (_, value) => {
    expect(parseUnderlay(value)).toBeNull();
  });

  it("parseUnderlay accepts a PNG mime: the shape check is not I16", () => {
    expect(parseUnderlay({ ...good, mime: "image/png" })).toEqual({ ...good, mime: "image/png" });
  });
});

describe("files", () => {
  it("a version-4 file without underlays loads with an empty table", () => {
    const json: Record<string, unknown> = { ...serialize(room) };
    delete json.underlays;
    expect(json.version).toBe(4);
    expect(unwrap(deserialize(json)).underlays).toEqual({});
    expect(serialize(placed).version).toBe(4);
  });

  it("an underlays table that is not a record is refused", () => {
    const json = { ...serialize(room), underlays: 3 };
    expect(deserialize(json)).toMatchObject({ ok: false, error: { message: "Invalid underlays table" } });
  });
});

describe("patch", () => {
  it("applyPatch refuses a malformed underlays put", () => {
    const entity: EntityValue = { ...good };
    delete entity.scaled;
    expect(applyPatch(room, { puts: [{ table: "underlays", entity }], deletes: [] })).toMatchObject({
      ok: false, error: { message: "Invalid underlays entity underlay" },
    });
  });
});

describe("wire", () => {
  it("the place patch passes validateChangeset, and a stored doc with the row parses on the wire and from a file", () => {
    const { patch } = unwrap(execute(room, place));
    const cs = validateChangeset({ id: "cs1", patch: { puts: patch.puts, deletes: [] }, expect: [{ ...key, lastCs: null }] });
    expect(cs.ok ? cs.value.patch.puts.length : cs.error).toBe(1);
    const stored = { ...emptyStored(), underlays: { underlay: good } };
    expect(parseStoredDocument(stored)?.underlays).toEqual(stored.underlays);
    expect(parseStoredDocument(stored, "empty")?.underlays).toEqual(stored.underlays);
  });
});
