import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A window's dressing on the plan (hangings step 05, AC-08): the curtain a wavy line and the box a dashed outline, both
// on the room side. The room is 6 × 4 with its bottom wall along y 0, its inner face at y 0.1.

const withWindow = (extra: Partial<Extract<Command, { type: "addOpening" }>> = {}): Document => {
  const doc = roomDoc();
  return withCommands(doc, { type: "addOpening", opId: "w", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "window", offset: 2.5, width: 1, ...extra });
};
const openings = (doc: Document): readonly Primitive[] => FakeShell.withDocument(doc).scene().layers.find((l) => l.name === "openings")?.primitives ?? [];
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const extra = (doc: Document) => {
  const plain = openings(withWindow()).length;
  return segments(openings(doc).slice(plain));
};

describe("a window's dressing on the plan (step 05, AC-08)", () => {
  it("a sheer draws a solid wave on the room side, within the window's width", () => {
    const wave = extra(withWindow({ sheer: "floor" }));
    expect(wave.length).toBeGreaterThan(8);
    const pts = wave.flatMap((s) => [s.a, s.b]);
    expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThan(0.1);
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(2.5 - 1e-9);
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(3.5 + 1e-9);
    expect(new Set(pts.map((p) => p.y.toFixed(4))).size).toBeGreaterThan(2); // it waves
    expect(wave.every((s) => s.dash === undefined)).toBe(true);
  });

  it("a shutter box draws a dashed rectangle on the room side, 0.12 deep", () => {
    const box = extra(withWindow({ shutterBox: true }));
    expect(box).toHaveLength(4);
    expect(box.every((s) => s.dash !== undefined)).toBe(true);
    const ys = box.flatMap((s) => [s.a.y, s.b.y]);
    expect([Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.1, 0.22]);
  });

  it("a plain window draws as before", () => {
    expect(extra(withWindow())).toEqual([]);
  });
});
