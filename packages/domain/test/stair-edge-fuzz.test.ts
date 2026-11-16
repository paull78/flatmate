import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { stairFits } from "../src/commands/place-stair";
import type { Command } from "../src/commands/types";
import type { DomainError } from "../src/errors";
import { OBJECT_KINDS, kindConfigs } from "../src/kinds";
import { emptyDocument, guardFor, type Document, sameGuards } from "../src/model";
import { stairEdges, stairOnEdge, type StairEdge } from "../src/queries/stair-edge";
import { stairChecks } from "../src/queries/stair-checks";
import { stairBase, stairGeometry } from "../src/queries/stairs";
import { placementRange } from "../src/queries/vertical";
import { rectangleRoom } from "../src/scripts";
import { validateDocument } from "../src/validate";
import { rng } from "./helpers";

// The preview and the commit can't disagree (stairdraw.19, lesson heights.19): whatever stairFits says about the parts
// stairOnEdge gives, placeStair agrees, for the same broken invariants, on random decks (turned, off the grid), random
// points within 1 cm of a caught edge, every stair kind, and a random wardrobe in the way. The commit's opId sorts after
// the wardrobe's and stairFits' own: a collision's text names the two pieces by ID order, so it may differ, never the
// verdict.

const STAIR_KINDS = OBJECT_KINDS.filter((k) => k.stair !== null).map((k) => k.id);
const TURNING_KINDS = OBJECT_KINDS.filter((k) => k.stair?.turns === true).map((k) => k.id);

/** An off-grid 6.4 × 5.2 room under 3.20 with one or two random decks and maybe a wardrobe; null when a deck didn't fit. */
function randomRoom(r: () => number): Document | null {
  const ox = 0.1 + r() * 0.9;
  const oy = 0.1 + r() * 0.9;
  let doc = unwrap(execute(emptyDocument(), { type: "setCeiling", height: 3.2 })).doc;
  for (const c of rectangleRoom({ x: ox, y: oy }, 6.4, 5.2, "r")) doc = unwrap(execute(doc, c)).doc;
  const decks = 1 + Math.floor(r() * 2);
  for (let i = 0; i < decks; i++) {
    const loft = r() < 0.5;
    const cmd: Command = {
      type: "addDeck", opId: `k${i}`, preset: loft ? "loft" : "platform",
      at: { x: ox + 1.2 + r() * 4, y: oy + 1.2 + r() * 2.8 }, w: 0.8 + Math.round(r() * 1700) / 1000, d: 0.8 + Math.round(r() * 1700) / 1000,
      rotation: Math.floor(r() * 360), top: loft ? 2.15 : [0.45, 0.9, 1.08][Math.floor(r() * 3)],
    };
    const placed = execute(doc, cmd);
    if (!placed.ok) return null;
    doc = placed.value.doc;
  }
  if (r() < 0.5) {
    const ward: Command = { type: "placeObject", opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: ox + 0.5 + r() * 5.4, y: oy + 1 + r() * 4 }, rotation: Math.floor(r() * 4) * 90, deck: null };
    const placed = execute(doc, ward);
    if (placed.ok) doc = placed.value.doc;
  }
  return doc;
}

/** A random point within 1 cm of `edge`, on either side. */
function nearEdge(r: () => number, edge: StairEdge): { x: number; y: number } {
  const t = r();
  const off = (r() - 0.5) * 0.018;
  return { x: edge.a.x + (edge.b.x - edge.a.x) * t + edge.normal.x * off, y: edge.a.y + (edge.b.y - edge.a.y) * t + edge.normal.y * off };
}

const verdict = (e: DomainError) => ({ kind: e.kind, invariants: e.violations.map((v) => v.invariant).sort() });

/** A placed flight's riser count, from where its steps begin to its top. */
function risersOf(doc: Document, placement: string): number {
  const p = doc.placements[placement];
  const o = p ? doc.objects[p.object] : undefined;
  const rule = o ? (OBJECT_KINDS.find((k) => k.id === o.kind)?.stair ?? null) : null;
  const range = placementRange(doc, placement);
  const base = stairBase(doc, placement);
  if (!p || !o || !rule || !range || base === null) return NaN;
  return stairGeometry(rule, o.w[p.config] ?? 0, o.d[p.config] ?? 0, range.top - base, null).risers;
}

describe("stairFits agrees with placeStair", () => {
  it("stairFits agrees with placeStair", () => {
    const r = rng(20261023);
    let fits = 0;
    let refused = 0;
    for (let trial = 0; trial < 400; trial++) {
      const doc = randomRoom(r);
      if (!doc) continue;
      const kind = STAIR_KINDS[Math.floor(r() * STAIR_KINDS.length)] ?? "stair";
      const w = kindConfigs(kind)[0]?.w ?? 0;
      const surface = r() < 0.25 ? (Object.keys(doc.decks).sort()[0] ?? null) : null;
      const edges = stairEdges(doc, surface, w);
      const edge = edges[Math.floor(r() * edges.length)];
      if (!edge) continue;
      const at = nearEdge(r, edge);
      const request = { state: "s0", kind, deck: edge.deck, at, shape: "straight" as const, surface };
      const parts = stairOnEdge(doc, request);
      if (!parts.ok) throw new Error(`seed trial ${trial}: a point on a caught edge was refused (${parts.error})`);
      const preview = stairFits(doc, parts.value, "s0");
      const commit = execute(doc, { type: "placeStair", opId: "zz", ...request });
      expect({ trial, said: preview.ok ? "fits" : verdict(preview.error) }).toEqual({ trial, said: commit.ok ? "fits" : verdict(commit.error) });
      if (commit.ok) {
        fits++;
        const p = commit.value.doc.placements["zz/s0/p0"];
        expect({ trial, at: p?.at, rotation: p?.rotation }).toEqual({ trial, at: parts.value.flights[0]?.at, rotation: parts.value.flights[0]?.rotation });
      } else refused++;
    }
    expect(fits).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(20);
  });

  it("L shapes: stairFits agrees with placeStair; every part passes validation", () => {
    const r = rng(20261024);
    let fits = 0;
    let refused = 0;
    let low = 0;
    for (let trial = 0; trial < 600; trial++) {
      const doc = randomRoom(r);
      if (!doc) continue;
      const kind = TURNING_KINDS[Math.floor(r() * TURNING_KINDS.length)] ?? "stair";
      const w = kindConfigs(kind)[0]?.w ?? 0;
      const surface = r() < 0.15 ? (Object.keys(doc.decks).sort()[0] ?? null) : null;
      const edges = stairEdges(doc, surface, w);
      const edge = edges[Math.floor(r() * edges.length)];
      if (!edge) continue;
      const request = { state: "s0", kind, deck: edge.deck, at: nearEdge(r, edge), shape: r() < 0.5 ? ("l-left" as const) : ("l-right" as const), surface };
      const parts = stairOnEdge(doc, request);
      if (!parts.ok) {
        // Only an edge too low for two flights of two risers is refused here.
        expect({ trial, error: parts.error }).toEqual({ trial, error: "tooLowToTurn" });
        low++;
        continue;
      }
      const preview = stairFits(doc, parts.value, "s0");
      const commit = execute(doc, { type: "placeStair", opId: "zz", ...request });
      expect({ trial, said: preview.ok ? "fits" : verdict(preview.error) }).toEqual({ trial, said: commit.ok ? "fits" : verdict(commit.error) });
      if (!commit.ok) {
        refused++;
        continue;
      }
      fits++;
      const next = commit.value.doc;
      expect({ trial, valid: validateDocument(next).ok }).toEqual({ trial, valid: true });
      const [upper, lower] = parts.value.flights;
      const landing = parts.value.landing;
      expect({ trial, deck: next.decks["zz/k0"] }).toEqual({ trial, deck: { id: "zz/k0", name: "Landing", solid: true, finish: null, ...sameGuards(guardFor(landing?.top ?? 0)), ...landing } });
      const placed = ["zz/s0/p0", "zz/s1/p0"].map((id) => ({ at: next.placements[id]?.at, rotation: next.placements[id]?.rotation }));
      expect({ trial, placed }).toEqual({ trial, placed: [upper, lower].map((f) => ({ at: f?.at, rotation: f?.rotation })) });
      expect({ trial, links: [next.objects["zz/s0/o0"]?.startsAt, next.objects["zz/s1/o0"]?.reaches] }).toEqual({ trial, links: ["zz/k0", "zz/k0"] });
      // Each flight's back touches what it reaches, and the risers split as the L says.
      const reach = ["zz/s0/o0", "zz/s1/o0"].map((id) => stairChecks(next, id).find((c) => c.id === "reach")?.ok);
      expect({ trial, reach }).toEqual({ trial, reach: [true, true] });
      const all = risersOf(next, "zz/s0/p0") + risersOf(next, "zz/s1/p0");
      expect({ trial, split: [risersOf(next, "zz/s0/p0"), risersOf(next, "zz/s1/p0")] }).toEqual({ trial, split: [Math.ceil(all / 2), all - Math.ceil(all / 2)] });
    }
    expect(fits).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(20);
    expect(low).toBeGreaterThan(0);
  });
});
