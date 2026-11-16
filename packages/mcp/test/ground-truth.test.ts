import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deserialize, distanceToSegment, isOpeningKind, OPENING_KINDS, serialize, unwrap, validateDocument, zones } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { compareTrace, outerWallIds } from "../scripts/compare-trace";
import { build, fixtureText, GROUND_TRUTH_ROOMS, GROUND_TRUTH_SHELL, groundTruthCommands, loadGroundTruth } from "../scripts/ground-truth-plan";

// The ground-truth drawing (import.18, AC-15): a committed stored project document that Claude's trace is compared with.

const FILE = readFileSync(new URL("./fixtures/ground-truth.json", import.meta.url), "utf8");
// Kinds read through OPENING_KINDS, not as literals (NO_KIND_LITERALS): the swing door and the window.
const KINDS = Object.keys(OPENING_KINDS).filter(isOpeningKind);
const SWING = KINDS.find((k) => OPENING_KINDS[k].clearance === "square");
const WINDOW = KINDS.find((k) => OPENING_KINDS[k].tool === "add_window");

/** The shell's edges, closing the ring. */
function shellEdges(): [Point, Point][] {
  return GROUND_TRUTH_SHELL.map((p, i): [Point, Point] => [p, GROUND_TRUTH_SHELL[(i + 1) % GROUND_TRUTH_SHELL.length] ?? p]);
}

describe("the ground-truth plan", () => {
  it("the committed fixture is what the commands build", () => {
    const doc = build(groundTruthCommands());
    expect(unwrap(deserialize(JSON.parse(FILE)))).toEqual(doc);
    expect(loadGroundTruth()).toEqual(doc);
    expect(serialize(doc)).toEqual(JSON.parse(FILE));
    expect(fixtureText(build(groundTruthCommands()))).toBe(fixtureText(doc));
    expect(fixtureText(doc)).toBe(FILE);
  });

  it("the fixture is a valid drawing with the planned features", () => {
    const doc = loadGroundTruth();
    expect(validateDocument(doc).ok).toBe(true);
    const rooms = zones(doc);
    expect(rooms).toHaveLength(4);
    const names = rooms.map((z) => z.labelIds.map((id) => doc.zoneLabels[id]?.name ?? "").join(" / "));
    expect(names.sort()).toEqual([...GROUND_TRUTH_ROOMS].sort());
    const walls = Object.values(doc.walls);
    expect(walls.filter((w) => w.thickness === 0.1)).toHaveLength(1);
    expect(walls.filter((w) => w.thickness !== 0.1).every((w) => w.thickness === 0.2)).toBe(true);
    const openings = Object.values(doc.openings);
    expect(SWING).toBeDefined();
    expect(WINDOW).toBeDefined();
    expect(openings.map((o) => o.kind).sort()).toEqual([SWING, WINDOW].sort());
    expect(Object.keys(doc.dimensions)).toHaveLength(2);

    const xs = GROUND_TRUTH_SHELL.map((p) => p.x);
    const ys = GROUND_TRUTH_SHELL.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
    const angles = GROUND_TRUTH_SHELL.map((p, i, ring) => {
      const prev = ring[(i + ring.length - 1) % ring.length] ?? p;
      const next = ring[(i + 1) % ring.length] ?? p;
      const u = { x: prev.x - p.x, y: prev.y - p.y };
      const v = { x: next.x - p.x, y: next.y - p.y };
      return (Math.acos((u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y)) * 180) / Math.PI;
    });
    expect(angles.some((a) => Math.abs(a - 90) > 1)).toBe(true);
    const joints = Object.values(doc.joints);
    let closest = Infinity;
    for (const [i, a] of joints.entries()) for (const b of joints.slice(i + 1)) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    expect(closest).toBeGreaterThanOrEqual(0.7);
  });

  it("the outer walls are exactly the walls on the shell outline", () => {
    const doc = loadGroundTruth();
    const onShell = Object.values(doc.walls).filter((w) => {
      const a = doc.joints[w.a];
      const b = doc.joints[w.b];
      if (!a || !b) return false;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return shellEdges().some(([p, q]) => distanceToSegment(mid, p, q) < 1e-9);
    });
    expect(onShell.length).toBeGreaterThan(5);
    expect(onShell.length).toBeLessThan(Object.keys(doc.walls).length);
    expect([...outerWallIds(doc)].sort()).toEqual(onShell.map((w) => w.id).sort());
  });

  it("the ground truth compared with itself passes", () => {
    const doc = loadGroundTruth();
    const report = compareTrace(doc, doc);
    expect(report.pass).toBe(true);
    expect(report.max).toBeLessThan(1e-9);
    const expected = GROUND_TRUTH_ROOMS.map((n) => n.trim().toLowerCase()).sort();
    expect(report.rooms).toEqual({ truth: expected, traced: expected, pass: true });
  });
});
