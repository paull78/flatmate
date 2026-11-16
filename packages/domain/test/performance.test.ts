import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { emptyDocument, type Document } from "../src/model";
import { PERF } from "./perf-switch";

// Timings print only with `--reporter=verbose` or `--silent=false`.
// Domain tests compile without DOM or Node types; Node provides these two globals at run time.
declare const performance: { now(): number };
declare const console: { log(message: string): void };

/** An n × n grid of 1 m rooms; grid(12) has 169 joints, 312 walls, 144 faces. */
function grid(n: number): Document {
  const doc: Document = emptyDocument();
  const j = (x: number, y: number) => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y), thickness: 0.2, top: "ceiling", base: "floor", column: false };
      if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1), thickness: 0.2, top: "ceiling", base: "floor", column: false };
    }
  }
  return doc;
}

describe.skipIf(!PERF)("performance (logs only, with FM_PERF=1; spec: domain says O(n²) is fine for a few hundred walls)", () => {
  it("validates and derives zones for 312 walls", () => {
    const doc = grid(12);
    let t = performance.now();
    const valid = validateDocument(doc);
    const validateMs = performance.now() - t;
    t = performance.now();
    const z = zones(doc);
    const zonesMs = performance.now() - t;
    console.log(`first call: validateDocument ${validateMs.toFixed(1)} ms, zones ${zonesMs.toFixed(1)} ms (312 walls)`);
    expect(valid.ok).toBe(true);
    expect(z).toHaveLength(144);
  });

  // The editor validates on every drag preview (spec: tools), so the warm cost is the one a drag pays.
  it("logs warm medians for validate, zones and a one-joint move on 312 walls", () => {
    const runs = 20;
    // zones memoizes per document object, so each zones run gets its own equal document, built before timing.
    const docs = Array.from({ length: runs }, () => grid(12));
    const zonesWarmUp = grid(12);
    const doc = grid(12);
    const same = Array.from({ length: runs }, () => doc);
    const move: Command = { type: "moveJoints", moves: [{ jointId: "j6_6", to: { x: 6.1, y: 6 } }] };
    // Runs f once on warmUp, then returns the median time of f over inputs.
    const median = <T>(f: (input: T) => void, warmUp: T, inputs: T[]): number => {
      f(warmUp);
      const times = inputs.map((input) => {
        const t = performance.now();
        f(input);
        return performance.now() - t;
      });
      times.sort((a, b) => a - b);
      return times[Math.floor(runs / 2)] ?? NaN;
    };
    const valid: boolean[] = [];
    const zoneCounts: number[] = [];
    const moved: boolean[] = [];
    const validateMs = median((d) => valid.push(validateDocument(d).ok), doc, same);
    const zonesMs = median((d) => zoneCounts.push(zones(d).length), zonesWarmUp, docs);
    const executeMs = median((d) => moved.push(execute(d, move).ok), doc, same);
    console.log(
      `warm median: validateDocument ${validateMs.toFixed(1)} ms, zones ${zonesMs.toFixed(1)} ms, ` +
        `execute(moveJoints) ${executeMs.toFixed(1)} ms (312 walls)`,
    );
    expect(valid.every(Boolean)).toBe(true);
    expect(zoneCounts).toEqual(Array.from({ length: runs + 1 }, () => 144));
    expect(moved.every(Boolean)).toBe(true);
  });
});
