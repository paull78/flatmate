# Phase 2: Domain kernel

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** Implement the whole `@fm/domain` contract: document model, invariants I1–I8, value patches, the six commands with deterministic normalisation, wall outlines, zones with clear areas, helper dimensions, hit candidates and versioned serialization. The phase ends with demo steps 2–6 scripted purely through `execute`.

**Spec:** §3 (all), §4.1 (`DomainPatch`, dependency table), §9 domain rows and the domain halves of the acceptance scenarios, §10 step 2.

**Prerequisites:** Gate 1 approved. `@fm/protocol` exports `Point`, `Result`, `ok`, `err`, `unwrap`, `assertNever`, `deepEqual`, `TableName`, `TABLE_NAMES`, `EntityKey`, `EntityValue`, `Patch`, `StoredDocument`, `keyOf`, `uniqueKeys` (README contracts). `packages/domain` exists with `package.json`, `tsconfig.json` (src, `lib: ["ES2022"]`, `types: []`) and `tsconfig.test.json` (tests).

**Design memory to read first:**
- `domain-geometry.md`, all of it. The Don'ts that bite in this phase:
  - no dimension entities;
  - no interior-crossing normalisation;
  - no nested-ring or three-label merge semantics;
  - no per-wall thickness;
  - one exterior face **per component**, not per graph;
  - a 0.10 m square insets to a *flipped positive-area* square, so use the edge-direction check;
  - bridges never subtract area;
  - no claims of bitwise cross-platform identity;
  - no 0.50 m minimum length;
  - memoization is not a performance strategy.
- `architecture.md`: the domain is plain pure synchronous functions; there are no ports; callers pass IDs in.
- `implementation.md`: P1, P2, P6 (commands diff before/after to build patches).
- `process.md` lessons 5, 6 and 8: realizable test examples, concrete degenerate counterexamples, and the full I1–I8 coverage.

**Verified while planning:** every code block below was run in a scratch copy (TypeScript 6.0.3, Vitest 5, typescript-eslint with `consistent-type-assertions: never`): 20 test files, 114 tests, `tsc` clean for `src` and tests, lint clean. If a step behaves differently in the repo, the difference is a finding: log it (README working rule 5).

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/domain/src/model.ts` | constants (`WALL_THICKNESS`, `EPS`, `MIN_EDGE`, `MIN_FACE_AREA`, `MAX_NAME_LENGTH`), entity and document types, `emptyDocument` |
| Create | `packages/domain/src/errors.ts` | `Violation`, `DomainError`, toast texts, `topologyMessage` |
| Create | `packages/domain/src/geometry.ts` | vector math, segment/line intersection, polygon area, containment and simplicity |
| Create | `packages/domain/src/shape.ts` | I8 parsers, `fromStored` / `toStored` |
| Create | `packages/domain/src/validate.ts` | `validateDocument` (I1–I8) |
| Create | `packages/domain/src/patch.ts` | `DomainPatch`, `diffPatch`, `applyPatch`, `invertPatch`, `changesTopology`, `entityValue` |
| Create | `packages/domain/src/graph.ts` | sorted IDs, incident walls, wall endpoints |
| Create | `packages/domain/src/commands/types.ts` | `Command`, `JointRef`, `CommandOf`, `CommandResult` |
| Create | `packages/domain/src/commands/move-joints.ts` | `moveJoints`, shared `applyMoves` |
| Create | `packages/domain/src/commands/add-wall.ts` | `addWall` normalisation (§3.4) |
| Create | `packages/domain/src/commands/set-wall-length.ts` | `setWallLength` |
| Create | `packages/domain/src/commands/labels.ts` | `labelZone`, `renameZone` |
| Create | `packages/domain/src/commands/delete-entities.ts` | `deleteEntities` with the two-room label merge |
| Create | `packages/domain/src/commands/execute.ts` | `execute` dispatcher |
| Create | `packages/domain/src/queries/outlines.ts` | `wallOutlines` (mitered joins) |
| Create | `packages/domain/src/queries/faces.ts` | bridge removal and face walk (`boundedFaces`, internal) |
| Create | `packages/domain/src/queries/area.ts` | `insetFloor` clear-area polygon |
| Create | `packages/domain/src/queries/zones.ts` | `zones`, `orphanLabelIds`, `faceAt` (memoized per document) |
| Create | `packages/domain/src/queries/helpers.ts` | `wallHelperDimension` |
| Create | `packages/domain/src/queries/hit.ts` | `hitCandidates` |
| Create | `packages/domain/src/serialize.ts` | `serialize`, `deserialize`, JSON-visitor migrations |
| Create | `packages/domain/src/scripts.ts` | `rectangleRoom` for scripts |
| Replace | `packages/domain/src/index.ts` | public exports (replaces the phase 1 placeholder) |
| Create | `packages/domain/test/helpers.ts` | `docOf`, `rectDoc` test builders |
| Create | `packages/domain/test/*.test.ts` | one test file per module, plus `demo-geometry` and `performance` |

All test commands run from the repo root. `pnpm --filter @fm/domain test <file>` runs one file (README working rule 2).

## Tasks

### Task 2.1: Model constants and error types

**Files:** Create `packages/domain/src/model.ts`, `packages/domain/src/errors.ts`, `packages/domain/test/model.test.ts`.

- [x] **Step 1: Check the package wiring.** Open `packages/domain/package.json`. It must contain `"dependencies": { "@fm/protocol": "workspace:*" }` and `"scripts": { "test": "vitest run", "typecheck": "…" }` from phase 1. If the dependency is missing, add it and run `pnpm install`. If phase 1 left a placeholder test in `packages/domain/test/`, delete it now. Keep `src/index.ts` until Task 2.18 replaces it.

- [x] **Step 2: Write the failing test** `packages/domain/test/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { invariantsMessage, topologyMessage } from "../src/errors";
import { EPS, MIN_EDGE, WALL_THICKNESS, emptyDocument } from "../src/model";

describe("model", () => {
  it("starts empty", () => {
    expect(emptyDocument()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
  });

  it("fixes thickness and tolerances (spec §3.2–3.3)", () => {
    expect(WALL_THICKNESS).toBe(0.2);
    expect(EPS).toBe(0.001);
    expect(MIN_EDGE).toBe(0.01);
  });

  it("names topology failures with toast texts", () => {
    const v = (invariant: "I2" | "I4" | "I5") => ({ invariant, message: "", entities: [] });
    expect(topologyMessage([v("I5")])).toBe("Walls can't cross");
    expect(topologyMessage([v("I2")])).toBe("Wall too short");
    expect(topologyMessage([v("I4")])).toBe("Joints can't overlap");
    expect(topologyMessage([v("I2"), v("I5")])).toBe("Walls can't cross");
  });

  it("maps invariant ids to toast texts, or null when none has one", () => {
    expect(invariantsMessage(new Set(["I5"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I6"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I2"]))).toBe("Wall too short");
    expect(invariantsMessage(new Set(["I4"]))).toBe("Joints can't overlap");
    expect(invariantsMessage(new Set(["I2", "I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I1", "I3", "I8", "I9"]))).toBeNull();
    expect(invariantsMessage(new Set())).toBeNull();
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/model.test.ts`
Expected: FAIL, because the imports `../src/errors` and `../src/model` cannot be resolved.

- [x] **Step 4: Implement** `packages/domain/src/model.ts`:

```ts
import type { EntityKey, Point } from "@fm/protocol";

export const WALL_THICKNESS = 0.2; // metres; the only wall thickness (spec §3.2)
export const EPS = 0.001; // 1 mm
export const MIN_EDGE = 0.01; // metres
export const MIN_FACE_AREA = 0.01; // m²
export const MAX_NAME_LENGTH = 200;

export type Joint = { id: string; x: number; y: number };
export type Wall = { id: string; a: string; b: string };
export type ZoneLabel = { id: string; at: Point; name: string };
export type Document = {
  joints: Record<string, Joint>;
  walls: Record<string, Wall>;
  zoneLabels: Record<string, ZoneLabel>;
};
export type EntityRef = EntityKey;

export function emptyDocument(): Document {
  return { joints: {}, walls: {}, zoneLabels: {} };
}
```

and `packages/domain/src/errors.ts`:

```ts
import type { EntityKey } from "@fm/protocol";

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8";
export type Violation = { invariant: InvariantId; message: string; entities: EntityKey[] };
export type DomainErrorKind =
  | "notFound" | "invalidInput" | "overlap" | "crossing" | "tooShort" | "topology" | "invalid" | "notInRoom" | "format";
export type DomainError = { kind: DomainErrorKind; message: string; violations: Violation[] };

// User-facing toast texts (spec §8).
export const MESSAGES = {
  tooShort: "Wall too short",
  crossing: "Walls can't cross",
  overlap: "Walls can't overlap",
  jointsMerge: "Joints can't overlap",
  splitTooShort: "Intersection would create a wall shorter than 1 cm",
  notInRoom: "Click inside a room",
  invalid: "Invalid drawing",
} as const;

export function domainError(kind: DomainErrorKind, message: string, violations: Violation[] = []): DomainError {
  return { kind, message, violations };
}

// The toast for a move or resize whose result breaks an invariant (spec §3.4).
export function topologyMessage(violations: Violation[]): string {
  return invariantsMessage(new Set(violations.map((v) => v.invariant))) ?? MESSAGES.invalid;
}

/**
 * The toast for a set of broken invariants, or null when none has one.
 * Takes plain strings so the editor can map ids parsed from a server rejection ("I5: walls cross").
 */
export function invariantsMessage(ids: ReadonlySet<string>): string | null {
  if (ids.has("I5") || ids.has("I6") || ids.has("I7")) return MESSAGES.crossing;
  if (ids.has("I2")) return MESSAGES.tooShort;
  if (ids.has("I4")) return MESSAGES.jointsMerge;
  return null;
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/model.test.ts`
Expected: PASS (3 tests).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: model constants, entity types and error messages"
```

### Task 2.2: Geometry primitives

**Files:** Create `packages/domain/src/geometry.ts`, `packages/domain/test/geometry.test.ts`.

The domain's tolerance rule lives here: segment ends touch within `EPS` (1 mm), and collinear segments count as overlapping only when they share more than `EPS` of length.

- [x] **Step 1: Write the failing test** `packages/domain/test/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  distanceToSegment, isSimplePolygon, lineIntersection, normalize, pointInPolygon, projectOnSegment,
  segmentIntersection, signedArea,
} from "../src/geometry";

const p = (x: number, y: number) => ({ x, y });

describe("geometry", () => {
  it("normalizes, refusing zero vectors", () => {
    expect(normalize(p(3, 4))).toEqual(p(0.6, 0.8));
    expect(normalize(p(0, 0))).toBeNull();
  });

  it("projects onto a segment and clamps to its ends", () => {
    expect(projectOnSegment(p(2, 5), p(0, 0), p(6, 0))).toEqual({ point: p(2, 0), t: 2 / 6 });
    expect(projectOnSegment(p(-3, 1), p(0, 0), p(6, 0)).point).toEqual(p(0, 0));
    expect(distanceToSegment(p(3, 2), p(0, 0), p(6, 0))).toBe(2);
  });

  it("finds a crossing point", () => {
    const hit = segmentIntersection(p(0, 0), p(4, 4), p(0, 4), p(4, 0));
    expect(hit).toMatchObject({ kind: "point", point: p(2, 2), t: 0.5, u: 0.5 });
  });

  it("reports touching ends as a point, within EPS", () => {
    expect(segmentIntersection(p(0, 0), p(2, 0), p(2.0005, 0), p(2.0005, 3)).kind).toBe("point");
    expect(segmentIntersection(p(0, 0), p(2, 0), p(2.01, 0.5), p(2.01, 3)).kind).toBe("none");
  });

  it("separates collinear overlap from collinear touching", () => {
    expect(segmentIntersection(p(0, 0), p(4, 0), p(3, 0), p(6, 0))).toEqual({ kind: "overlap", length: 1 });
    expect(segmentIntersection(p(0, 0), p(4, 0), p(4, 0), p(6, 0)).kind).toBe("point");
    expect(segmentIntersection(p(0, 0), p(4, 0), p(5, 0), p(6, 0)).kind).toBe("none");
    expect(segmentIntersection(p(0, 0), p(4, 0), p(0, 1), p(4, 1)).kind).toBe("none");
  });

  it("intersects infinite lines", () => {
    expect(lineIntersection(p(0, 1), p(1, 0), p(3, 0), p(0, 1))).toEqual(p(3, 1));
    expect(lineIntersection(p(0, 0), p(1, 0), p(0, 1), p(2, 0))).toBeNull();
  });

  it("gives CCW rings positive area", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    expect(signedArea(square)).toBe(4);
    expect(signedArea([...square].reverse())).toBe(-4);
  });

  it("tests containment and simplicity", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    expect(pointInPolygon(p(1, 1), square)).toBe(true);
    expect(pointInPolygon(p(3, 1), square)).toBe(false);
    expect(isSimplePolygon(square)).toBe(true);
    expect(isSimplePolygon([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toBe(false); // bow tie
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/geometry.test.ts`
Expected: FAIL, because `../src/geometry` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/geometry.ts`:

```ts
import type { Point } from "@fm/protocol";
import { EPS } from "./model";

export function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a: Point, k: number): Point { return { x: a.x * k, y: a.y * k }; }
export function dot(a: Point, b: Point): number { return a.x * b.x + a.y * b.y; }
export function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x; }
export function length(v: Point): number { return Math.hypot(v.x, v.y); }
export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function perpLeft(v: Point): Point { return { x: -v.y, y: v.x }; }

export function normalize(v: Point): Point | null {
  const l = length(v);
  return l < 1e-12 ? null : { x: v.x / l, y: v.y / l };
}

/** Closest point on segment ab to p; t ∈ [0, 1] is its parameter along ab. */
export function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-24) return { point: a, t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return { point: add(a, scale(ab, t)), t };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, projectOnSegment(p, a, b).point);
}

export type SegmentHit =
  | { kind: "none" }
  | { kind: "point"; point: Point; t: number; u: number }
  | { kind: "overlap"; length: number };

/**
 * Intersection of segments ab and cd with an EPS tolerance at the ends.
 * Collinear segments sharing more than EPS of length report "overlap".
 */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): SegmentHit {
  const r = sub(b, a);
  const s = sub(d, c);
  const lr = length(r);
  const ls = length(s);
  if (lr < 1e-12 || ls < 1e-12) return { kind: "none" };
  const denom = cross(r, s);
  const ac = sub(c, a);
  if (Math.abs(denom) < 1e-9 * lr * ls) {
    // Parallel: overlap only if collinear.
    if (Math.abs(cross(ac, r)) / lr >= EPS) return { kind: "none" };
    const t0 = dot(ac, r) / (lr * lr);
    const t1 = dot(sub(d, a), r) / (lr * lr);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    const shared = (hi - lo) * lr;
    if (shared > EPS) return { kind: "overlap", length: shared };
    if (shared < -EPS) return { kind: "none" };
    const t = Math.min(1, Math.max(0, (lo + hi) / 2));
    const point = add(a, scale(r, t));
    return { kind: "point", point, t, u: dot(sub(point, c), s) / (ls * ls) };
  }
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  const tolT = EPS / lr;
  const tolU = EPS / ls;
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return { kind: "none" };
  return { kind: "point", point: add(a, scale(r, Math.min(1, Math.max(0, t)))), t, u };
}

/** Intersection of the infinite lines p + t·d and q + u·e, or null when parallel. */
export function lineIntersection(p: Point, d: Point, q: Point, e: Point): Point | null {
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-12 * length(d) * length(e)) return null;
  const t = cross(sub(q, p), e) / denom;
  return add(p, scale(d, t));
}

/** Shoelace area; positive when the ring runs counter-clockwise (y up). */
export function signedArea(ring: Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p && q) s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** Even-odd containment; points on the boundary may go either way. */
export function pointInPolygon(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** No two non-adjacent edges touch, and adjacent edges do not fold back onto each other. */
export function isSimplePolygon(ring: Point[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  const edge = (i: number): [Point, Point] | null => {
    const a = ring[i % n];
    const b = ring[(i + 1) % n];
    return a && b ? [a, b] : null;
  };
  for (let i = 0; i < n; i++) {
    const e1 = edge(i);
    if (!e1) return false;
    for (let j = i + 1; j < n; j++) {
      const e2 = edge(j);
      if (!e2) return false;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const hit = segmentIntersection(e1[0], e1[1], e2[0], e2[1]);
      if (adjacent) {
        if (hit.kind === "overlap") return false;
      } else if (hit.kind !== "none") {
        return false;
      }
    }
  }
  return true;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/geometry.test.ts`
Expected: PASS (8 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: vector math, segment intersection and polygon helpers"
```

### Task 2.3: Shape parsing (I8) and the stored form

**Files:** Create `packages/domain/src/shape.ts`, `packages/domain/test/helpers.ts`, `packages/domain/test/shape.test.ts`.

Parsers use type predicates and `typeof` checks, never casts. They keep only known fields, as spec §3.7 requires ("unknown fields are not preserved").

- [x] **Step 1: Add the test builders** `packages/domain/test/helpers.ts` (used by every later test):

```ts
import type { Document } from "../src/model";

type Spec = {
  joints?: [id: string, x: number, y: number][];
  walls?: [id: string, a: string, b: string][];
  labels?: [id: string, x: number, y: number, name: string][];
};

/** Builds a document from compact tuples; no validation. */
export function docOf(spec: Spec): Document {
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  for (const [id, x, y] of spec.joints ?? []) doc.joints[id] = { id, x, y };
  for (const [id, a, b] of spec.walls ?? []) doc.walls[id] = { id, a, b };
  for (const [id, x, y, name] of spec.labels ?? []) doc.zoneLabels[id] = { id, at: { x, y }, name };
  return doc;
}

/** A closed rectangle J1(x0,y0) J2(x1,y0) J3(x1,y1) J4(x0,y1), walls W1..W4 counter-clockwise. */
export function rectDoc(x0: number, y0: number, x1: number, y1: number): Document {
  return docOf({
    joints: [["J1", x0, y0], ["J2", x1, y0], ["J3", x1, y1], ["J4", x0, y1]],
    walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
  });
}
```

- [x] **Step 2: Write the failing test** `packages/domain/test/shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromStored, isValidId, parseJoint, parseWall, parseZoneLabel, toStored } from "../src/shape";
import { docOf } from "./helpers";

describe("shape (I8)", () => {
  it("accepts plain IDs and rejects others", () => {
    for (const id of ["J1", "op-7/j0", "a.b:c_d"]) expect(isValidId(id)).toBe(true);
    for (const id of ["", "has space", "x".repeat(129), 7, null]) expect(isValidId(id)).toBe(false);
  });

  it("parses entities and drops unknown fields", () => {
    expect(parseJoint({ id: "J1", x: 1, y: 2, color: "red" })).toEqual({ id: "J1", x: 1, y: 2 });
    expect(parseJoint({ id: "J1", x: Number.NaN, y: 2 })).toBeNull();
    expect(parseJoint({ id: "J1", x: Infinity, y: 2 })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2" })).toEqual({ id: "W1", a: "J1", b: "J2" });
    expect(parseWall({ id: "W1", a: "J1" })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" })).toEqual({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" });
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "x".repeat(201) })).toBeNull();
  });

  it("round-trips through the stored shape", () => {
    const doc = docOf({ joints: [["J1", 0, 0], ["J2", 1, 0]], walls: [["W1", "J1", "J2"]], labels: [["L1", 5, 5, "Hall"]] });
    const back = fromStored(toStored(doc));
    expect(back).toEqual({ ok: true, value: doc });
  });

  it("rejects an entry whose key differs from its ID", () => {
    const r = fromStored({ joints: { J1: { id: "J9", x: 0, y: 0 } }, walls: {}, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry J1" } });
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/shape.test.ts`
Expected: FAIL, because `../src/shape` cannot be resolved.

- [x] **Step 4: Implement** `packages/domain/src/shape.ts` (revised: `ID_PATTERN` has no `\/` escape, which fails `no-useless-escape`):

```ts
import { err, isRecord, ok } from "@fm/protocol";
import type { Point, Result, StoredDocument, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { MAX_NAME_LENGTH, type Document, type Joint, type Wall, type ZoneLabel } from "./model";

const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;

export function isValidId(v: unknown): v is string {
  return typeof v === "string" && ID_PATTERN.test(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidName(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_NAME_LENGTH;
}

export function parsePoint(v: unknown): Point | null {
  if (!isRecord(v)) return null;
  const { x, y } = v;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null;
}

export function parseJoint(v: unknown): Joint | null {
  if (!isRecord(v)) return null;
  const { id, x, y } = v;
  return isValidId(id) && isFiniteNumber(x) && isFiniteNumber(y) ? { id, x, y } : null;
}

export function parseWall(v: unknown): Wall | null {
  if (!isRecord(v)) return null;
  const { id, a, b } = v;
  return isValidId(id) && isValidId(a) && isValidId(b) ? { id, a, b } : null;
}

export function parseZoneLabel(v: unknown): ZoneLabel | null {
  if (!isRecord(v)) return null;
  const { id, at, name } = v;
  const point = parsePoint(at);
  return isValidId(id) && point && isValidName(name) ? { id, at: point, name } : null;
}

/** Parses one table of unknown values; each entry's key must equal its ID (I8). */
function parseTable<T extends { id: string }>(
  table: TableName,
  raw: unknown,
  parse: (v: unknown) => T | null,
): Result<Record<string, T>, DomainError> {
  if (!isRecord(raw)) return err(domainError("format", `Invalid ${table} table`));
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parse(value);
    if (!parsed || parsed.id !== key) return err(domainError("format", `Invalid ${table} entry ${key}`));
    out[key] = parsed;
  }
  return ok(out);
}

/** Shape-checks the three tables of an unknown object (no geometry validation). */
export function parseTables(raw: Record<string, unknown>): Result<Document, DomainError> {
  const joints = parseTable("joints", raw.joints, parseJoint);
  if (!joints.ok) return joints;
  const walls = parseTable("walls", raw.walls, parseWall);
  if (!walls.ok) return walls;
  const zoneLabels = parseTable("zoneLabels", raw.zoneLabels, parseZoneLabel);
  if (!zoneLabels.ok) return zoneLabels;
  return ok({ joints: joints.value, walls: walls.value, zoneLabels: zoneLabels.value });
}

export function fromStored(stored: StoredDocument): Result<Document, DomainError> {
  return parseTables(stored);
}

export function toStored(doc: Document): StoredDocument {
  return { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/shape.test.ts`
Expected: PASS (4 tests).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: I8 shape parsers and stored-document conversion"
```

### Task 2.4: `validateDocument` (I1–I8)

**Files:** Create `packages/domain/src/validate.ts`, `packages/domain/test/validate.test.ts`.

Shape (I8) is checked first; if it fails, only I8 violations are returned, because the geometry checks assume finite numbers. The pair tests are O(n²) (spec §3.3). Walls sharing both joints are a duplicate, which is I7.

- [x] **Step 1: Write the failing test** `packages/domain/test/validate.test.ts` (one test per invariant, including malformed IDs, NaN, Infinity and a key/ID mismatch):

```ts
import { describe, expect, it } from "vitest";
import type { InvariantId } from "../src/errors";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

function invariants(doc: Document): InvariantId[] {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
}

describe("validateDocument", () => {
  it("accepts an empty document and a closed room", () => {
    expect(invariants({ joints: {}, walls: {}, zoneLabels: {} })).toEqual([]);
    expect(invariants(rectDoc(0, 0, 6, 4))).toEqual([]);
  });

  it("I1: walls need two existing, distinct joints", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "Z"]] }))).toContain("I1");
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "A"]] }))).toContain("I1");
  });

  it("I2: walls are at least 1 cm long", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.009, 0]], walls: [["W", "A", "B"]] }))).toEqual(["I2"]);
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.01, 0]], walls: [["W", "A", "B"]] }))).toEqual([]);
  });

  it("I3: every joint is used", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 1, 0], ["C", 5, 5]], walls: [["W", "A", "B"]] }))).toEqual(["I3"]);
  });

  it("I4: joints are at least 1 mm apart", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 1, 0], ["C", 1.0005, 0], ["D", 1.0005, 1]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toContain("I4");
  });

  it("I5: walls cross only at a shared joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 4], ["C", 0, 4], ["D", 4, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toEqual(["I5"]);
  });

  it("I6: no joint lies on another wall's body", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 6, 0], ["T", 3, 0], ["U", 3, 4]],
      walls: [["W1", "A", "B"], ["W2", "T", "U"]],
    });
    expect(invariants(doc)).toContain("I6");
  });

  it("I7: walls do not overlap collinearly", () => {
    const partial = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 2, 0.0], ["D", 6, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(partial)).toContain("I7");
    const duplicate = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W1", "A", "B"], ["W2", "B", "A"]] });
    expect(invariants(duplicate)).toEqual(["I7"]);
  });

  it("I8: malformed IDs and non-finite numbers", () => {
    const badId = docOf({ joints: [["bad id", 0, 0], ["B", 1, 0]], walls: [["W", "bad id", "B"]] });
    expect(invariants(badId)).toEqual(["I8"]);
    const nan = docOf({ joints: [["A", Number.NaN, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] });
    expect(invariants(nan)).toEqual(["I8"]);
    const inf = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]], labels: [["L", Infinity, 0, "x"]] });
    expect(invariants(inf)).toEqual(["I8"]);
    const keyMismatch: Document = { joints: { A: { id: "Z", x: 0, y: 0 } }, walls: {}, zoneLabels: {} };
    expect(invariants(keyMismatch)).toEqual(["I8"]);
  });

  it("accepts a T-junction whose stem ends at a split joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["S", 3, 0], ["B", 6, 0], ["T", 3, 4]],
      walls: [["W1", "A", "S"], ["W2", "S", "B"], ["W3", "S", "T"]],
    });
    expect(invariants(doc)).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/validate.test.ts`
Expected: FAIL, because `../src/validate` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/validate.ts`:

```ts
import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import type { Violation } from "./errors";
import { distance, distanceToSegment, segmentIntersection } from "./geometry";
import { EPS, MIN_EDGE, type Document, type Wall } from "./model";
import { isFiniteNumber, isValidId, isValidName } from "./shape";

const jointKey = (id: string): EntityKey => ({ table: "joints", id });
const wallKey = (id: string): EntityKey => ({ table: "walls", id });

/** I8: IDs, keys, coordinates and label fields. */
function shapeViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const bad = (table: EntityKey["table"], id: string, what: string): void => {
    out.push({ invariant: "I8", message: `${table} ${id}: ${what}`, entities: [{ table, id }] });
  };
  for (const [key, j] of Object.entries(doc.joints)) {
    if (!isValidId(j.id) || j.id !== key) bad("joints", key, "invalid ID");
    else if (!isFiniteNumber(j.x) || !isFiniteNumber(j.y)) bad("joints", key, "coordinates must be finite");
  }
  for (const [key, w] of Object.entries(doc.walls)) {
    if (!isValidId(w.id) || w.id !== key || !isValidId(w.a) || !isValidId(w.b)) bad("walls", key, "invalid ID");
  }
  for (const [key, l] of Object.entries(doc.zoneLabels)) {
    if (!isValidId(l.id) || l.id !== key) bad("zoneLabels", key, "invalid ID");
    else if (!isFiniteNumber(l.at.x) || !isFiniteNumber(l.at.y)) bad("zoneLabels", key, "position must be finite");
    else if (!isValidName(l.name)) bad("zoneLabels", key, "name too long");
  }
  return out;
}

type Segment = { wall: Wall; a: Point; b: Point };

/** Checks invariants I1–I8 (spec §3.3). O(n²) pair tests. */
export function validateDocument(doc: Document): Result<void, Violation[]> {
  const shape = shapeViolations(doc);
  if (shape.length > 0) return err(shape);

  const out: Violation[] = [];
  const segments: Segment[] = [];
  const used = new Set<string>();
  const wallIds = Object.keys(doc.walls).sort();
  const jointIds = Object.keys(doc.joints).sort();

  for (const id of wallIds) {
    const wall = doc.walls[id];
    if (!wall) continue;
    const a = doc.joints[wall.a];
    const b = doc.joints[wall.b];
    if (!a || !b || wall.a === wall.b) {
      out.push({ invariant: "I1", message: `Wall ${id} needs two existing, distinct joints`, entities: [wallKey(id)] });
      continue;
    }
    used.add(wall.a);
    used.add(wall.b);
    if (distance(a, b) < MIN_EDGE) {
      out.push({ invariant: "I2", message: `Wall ${id} is shorter than 1 cm`, entities: [wallKey(id)] });
    }
    segments.push({ wall, a, b });
  }

  for (const id of jointIds) {
    if (!used.has(id)) out.push({ invariant: "I3", message: `Joint ${id} is not used by any wall`, entities: [jointKey(id)] });
  }

  const joints = jointIds.flatMap((id) => doc.joints[id] ?? []);
  joints.forEach((p, i) => {
    for (const q of joints.slice(i + 1)) {
      if (distance(p, q) < EPS) {
        out.push({ invariant: "I4", message: `Joints ${p.id} and ${q.id} coincide`, entities: [jointKey(p.id), jointKey(q.id)] });
      }
    }
  });

  segments.forEach((s, i) => {
    for (const t of segments.slice(i + 1)) {
      const shared = [s.wall.a, s.wall.b].filter((j) => j === t.wall.a || j === t.wall.b);
      const entities = [wallKey(s.wall.id), wallKey(t.wall.id)];
      if (shared.length === 2) {
        out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
        continue;
      }
      const hit = segmentIntersection(s.a, s.b, t.a, t.b);
      if (hit.kind === "overlap") {
        out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
      } else if (hit.kind === "point") {
        const sharedJoint = shared[0] === undefined ? undefined : doc.joints[shared[0]];
        if (!sharedJoint || distance(hit.point, sharedJoint) >= EPS) {
          out.push({ invariant: "I5", message: `Walls ${s.wall.id} and ${t.wall.id} cross`, entities });
        }
      }
    }
  });

  for (const j of joints) {
    for (const s of segments) {
      if (s.wall.a === j.id || s.wall.b === j.id) continue;
      if (distanceToSegment(j, s.a, s.b) < EPS) {
        out.push({ invariant: "I6", message: `Joint ${j.id} lies on wall ${s.wall.id}`, entities: [jointKey(j.id), wallKey(s.wall.id)] });
      }
    }
  }

  return out.length === 0 ? ok(undefined) : err(out);
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/validate.test.ts`
Expected: PASS (10 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: validateDocument checks invariants I1-I8"
```

### Task 2.5: Value patches

**Files:** Create `packages/domain/src/patch.ts`, `packages/domain/test/patch.test.ts`.

Every command computes the next document and calls `diffPatch(before, after, dependencies)` (README P6). As a result, `puts`, `deletes` and `before` always agree, and the entries are ordered by table and then ID, independent of insertion order. `dependencies` holds the command's semantic dependencies, sorted and unique. It may overlap the writes: consumers take the union (spec §4.1).

- [x] **Step 1: Write the failing test** `packages/domain/test/patch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyPatch, changesTopology, diffPatch, entityValue, invertPatch } from "../src/patch";
import { docOf } from "./helpers";

const before = docOf({
  joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]],
  walls: [["W1", "A", "B"], ["W2", "B", "C"]],
  labels: [["L1", 1, 1, "Hall"]],
});

describe("diffPatch", () => {
  it("records puts, deletes and previous values, ordered by table then ID", () => {
    const after = docOf({
      joints: [["A", 0, 0], ["B", 4, 0.5], ["D", 9, 9]],
      walls: [["W1", "A", "B"]],
      labels: [["L1", 1, 1, "Kitchen"]],
    });
    const p = diffPatch(before, after, [{ table: "walls", id: "W1" }, { table: "walls", id: "W1" }]);
    expect(p.puts).toEqual([
      { table: "joints", entity: { id: "B", x: 4, y: 0.5 } },
      { table: "joints", entity: { id: "D", x: 9, y: 9 } },
      { table: "zoneLabels", entity: { id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" } },
    ]);
    expect(p.deletes).toEqual([{ table: "joints", id: "C" }, { table: "walls", id: "W2" }]);
    expect(p.before).toEqual([
      { table: "joints", id: "B", value: { id: "B", x: 4, y: 0 } },
      { table: "joints", id: "C", value: { id: "C", x: 4, y: 3 } },
      { table: "joints", id: "D", value: null },
      { table: "walls", id: "W2", value: { id: "W2", a: "B", b: "C" } },
      { table: "zoneLabels", id: "L1", value: { id: "L1", at: { x: 1, y: 1 }, name: "Hall" } },
    ]);
    expect(p.dependencies).toEqual([{ table: "walls", id: "W1" }]);
  });

  it("is empty when nothing changed", () => {
    const p = diffPatch(before, { ...before, joints: { ...before.joints } }, []);
    expect(p.puts).toEqual([]);
    expect(p.deletes).toEqual([]);
  });
});

describe("applyPatch and invertPatch", () => {
  it("apply then invert returns the original document", () => {
    const after = docOf({ joints: [["A", 0, 0], ["B", 4, 1]], walls: [["W1", "A", "B"]], labels: [["L1", 1, 1, "Hall"]] });
    const p = diffPatch(before, after, []);
    const applied = applyPatch(before, p);
    expect(applied).toEqual({ ok: true, value: after });
    const back = applied.ok ? applyPatch(applied.value, invertPatch(p)) : applied;
    expect(back).toEqual({ ok: true, value: before });
  });

  it("rejects malformed put values", () => {
    const r = applyPatch(before, { puts: [{ table: "joints", entity: { id: "X", x: "1", y: 0 } }], deletes: [] });
    expect(r).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("reads entity values by key", () => {
    expect(entityValue(before, { table: "walls", id: "W2" })).toEqual({ id: "W2", a: "B", b: "C" });
    expect(entityValue(before, { table: "walls", id: "nope" })).toBeNull();
  });
});

describe("changesTopology", () => {
  it("is false for moves and label edits", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "B", x: 5, y: 0 } }], deletes: [] })).toBe(false);
    expect(changesTopology(before, { puts: [{ table: "zoneLabels", entity: { id: "L2", at: { x: 0, y: 0 }, name: "" } }], deletes: [{ table: "zoneLabels", id: "L1" }] })).toBe(false);
  });

  it("is true for created or deleted joints and walls, and changed endpoints", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "N", x: 9, y: 0 } }], deletes: [] })).toBe(true);
    expect(changesTopology(before, { puts: [], deletes: [{ table: "walls", id: "W2" }] })).toBe(true);
    expect(changesTopology(before, { puts: [{ table: "walls", entity: { id: "W2", a: "B", b: "A" } }], deletes: [] })).toBe(true);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/patch.test.ts`
Expected: FAIL, because `../src/patch` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/patch.ts`:

```ts
import { TABLE_NAMES, assertNever, deepEqual, err, keyOf, ok, uniqueKeys } from "@fm/protocol";
import type { EntityKey, EntityValue, Patch, Result, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import type { Document } from "./model";
import { parseJoint, parseWall, parseZoneLabel } from "./shape";

export type DomainPatch = Patch & {
  before: (EntityKey & { value: EntityValue | null })[];
  dependencies: EntityKey[];
};

export function entityValue(doc: Document, key: EntityKey): EntityValue | null {
  switch (key.table) {
    case "joints": return doc.joints[key.id] ?? null;
    case "walls": return doc.walls[key.id] ?? null;
    case "zoneLabels": return doc.zoneLabels[key.id] ?? null;
    default: return assertNever(key.table);
  }
}

function tableIds(doc: Document, table: TableName): string[] {
  switch (table) {
    case "joints": return Object.keys(doc.joints);
    case "walls": return Object.keys(doc.walls);
    case "zoneLabels": return Object.keys(doc.zoneLabels);
    default: return assertNever(table);
  }
}

const byKey = (x: EntityKey, y: EntityKey): number => (keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0);

/**
 * The patch that turns `before` into `after`: puts for new or changed entities, deletes for removed
 * ones, previous values for every write, and the command's semantic dependencies (sorted, unique).
 * Entries are ordered by table (joints, walls, zoneLabels), then by ID.
 */
export function diffPatch(before: Document, after: Document, dependencies: EntityKey[]): DomainPatch {
  const patch: DomainPatch = { puts: [], deletes: [], before: [], dependencies: uniqueKeys(dependencies).sort(byKey) };
  for (const table of TABLE_NAMES) {
    const ids = [...new Set([...tableIds(before, table), ...tableIds(after, table)])].sort();
    for (const id of ids) {
      const key = { table, id };
      const was = entityValue(before, key);
      const now = entityValue(after, key);
      if (was === now) continue;
      if (now && (!was || !deepEqual(was, now))) {
        patch.puts.push({ table, entity: now });
        patch.before.push({ table, id, value: was });
      } else if (!now && was) {
        patch.deletes.push(key);
        patch.before.push({ table, id, value: was });
      }
    }
  }
  return patch;
}

/** Applies puts and deletes; put values are shape-checked. Does not validate the result. */
export function applyPatch(doc: Document, p: Patch): Result<Document, DomainError> {
  const next: Document = { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
  for (const { table, id } of p.deletes) {
    switch (table) {
      case "joints": delete next.joints[id]; break;
      case "walls": delete next.walls[id]; break;
      case "zoneLabels": delete next.zoneLabels[id]; break;
      default: assertNever(table);
    }
  }
  for (const { table, entity } of p.puts) {
    const invalid = err(domainError("format", `Invalid ${table} entity ${entity.id}`));
    switch (table) {
      case "joints": { const v = parseJoint(entity); if (!v) return invalid; next.joints[v.id] = v; break; }
      case "walls": { const v = parseWall(entity); if (!v) return invalid; next.walls[v.id] = v; break; }
      case "zoneLabels": { const v = parseZoneLabel(entity); if (!v) return invalid; next.zoneLabels[v.id] = v; break; }
      default: assertNever(table);
    }
  }
  return ok(next);
}

/** Puts back every previous value and deletes every created entity. */
export function invertPatch(p: DomainPatch): Patch {
  const puts: Patch["puts"] = [];
  const deletes: EntityKey[] = [];
  for (const b of p.before) {
    if (b.value) puts.push({ table: b.table, entity: b.value });
    else deletes.push({ table: b.table, id: b.id });
  }
  return { puts, deletes };
}

/** True when `p` creates or deletes a joint or wall, or changes a wall's endpoints (spec §4.1). */
export function changesTopology(doc: Document, p: Patch): boolean {
  for (const { table, id } of p.deletes) {
    if ((table === "joints" && doc.joints[id]) || (table === "walls" && doc.walls[id])) return true;
  }
  for (const { table, entity } of p.puts) {
    if (table === "joints" && !doc.joints[entity.id]) return true;
    if (table === "walls") {
      const was = doc.walls[entity.id];
      const now = parseWall(entity);
      if (!was || !now || was.a !== now.a || was.b !== now.b) return true;
    }
  }
  return false;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/patch.test.ts`
Expected: PASS (7 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: diff, apply and invert value patches; detect topology changes"
```

### Task 2.6: Graph helpers

**Files:** Create `packages/domain/src/graph.ts`, `packages/domain/test/graph.test.ts`.

`sortedIds` uses the default `sort()`, which orders by UTF-16 code units. That is the "lexicographic ID order" of spec §3.4, and it is the same in every runtime. Do not use `localeCompare`.

- [x] **Step 1: Write the failing test** `packages/domain/test/graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { incidentWalls, jointWalls, sortedIds, wallEnds } from "../src/graph";
import { docOf } from "./helpers";

describe("graph helpers", () => {
  const doc = docOf({
    joints: [["B", 4, 0], ["A", 0, 0], ["C", 4, 3]],
    walls: [["W2", "B", "C"], ["W1", "A", "B"]],
  });

  it("sorts IDs lexicographically regardless of insertion order", () => {
    expect(sortedIds(doc.joints)).toEqual(["A", "B", "C"]);
  });

  it("lists incident walls by ID", () => {
    expect(incidentWalls(doc, "B")).toEqual(["W1", "W2"]);
    expect(jointWalls(doc).get("B")).toEqual(["W1", "W2"]);
  });

  it("reads wall endpoints", () => {
    expect(wallEnds(doc, "W2")).toEqual({ a: { x: 4, y: 0 }, b: { x: 4, y: 3 } });
    expect(wallEnds(doc, "nope")).toBeNull();
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/graph.test.ts`
Expected: FAIL, because `../src/graph` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/graph.ts`:

```ts
import type { Point } from "@fm/protocol";
import type { Document } from "./model";

/** IDs of a table in lexicographic (UTF-16 code unit) order: the order normalisation inspects entities. */
export function sortedIds<T>(table: Record<string, T>): string[] {
  return Object.keys(table).sort();
}

/** Walls using the joint, sorted by ID. */
export function incidentWalls(doc: Document, jointId: string): string[] {
  return sortedIds(doc.walls).filter((id) => {
    const w = doc.walls[id];
    return w !== undefined && (w.a === jointId || w.b === jointId);
  });
}

/** Joint ID → incident wall IDs (sorted), for every joint that has walls. */
export function jointWalls(doc: Document): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (!w) continue;
    for (const j of [w.a, w.b]) map.set(j, [...(map.get(j) ?? []), id]);
  }
  return map;
}

export function jointPoint(doc: Document, id: string): Point | null {
  const j = doc.joints[id];
  return j ? { x: j.x, y: j.y } : null;
}

/** The two endpoint positions of a wall, or null when the wall or a joint is missing. */
export function wallEnds(doc: Document, wallId: string): { a: Point; b: Point } | null {
  const w = doc.walls[wallId];
  if (!w) return null;
  const a = jointPoint(doc, w.a);
  const b = jointPoint(doc, w.b);
  return a && b ? { a, b } : null;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/graph.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: graph helpers for incident walls and endpoints"
```

### Task 2.7: Command types and `moveJoints`

**Files:** Create `packages/domain/src/commands/types.ts`, `packages/domain/src/commands/move-joints.ts`, `packages/domain/test/move-joints.test.ts`.

Only the destination matters: the result is validated and nothing else is checked, with no swept path (spec §3.4). Dependencies are the moved joints and their incident walls (§4.1 table). `applyMoves` is shared with `setWallLength`.

(revised 2026-09-28: the code below is the final code. The wave 1 review added the `isValidId` check before the joint lookup; the wave 4 spec review made a no-op move return the input document; the wave 4 code review moved that rule into `execute` for every command, so `moveJoints` itself returns its new document again; the wave 5 spec review made the crossing test check that the input is unchanged.)

- [x] **Step 1: Write the failing test** `packages/domain/test/move-joints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { moveJoints } from "../src/commands/move-joints";
import { deepFreeze, docOf, rectDoc } from "./helpers";

describe("moveJoints", () => {
  it("moves a joint; connected walls follow; deps are the joint and its walls", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 3.5 } }] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J3).toEqual({ id: "J3", x: 6, y: 3.5 });
    expect(r.value.patch.puts).toEqual([{ table: "joints", entity: { id: "J3", x: 6, y: 3.5 } }]);
    expect(r.value.patch.before).toEqual([{ table: "joints", id: "J3", value: { id: "J3", x: 6, y: 4 } }]);
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J3" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" },
    ]);
    expect(doc.joints.J3).toEqual({ id: "J3", x: 6, y: 4 }); // input untouched
  });

  it("only the destination matters: a free wall may jump across another wall", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 0, 4], ["C", 2, 1], ["D", 2, 3]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: -2, y: 1 } }, { jointId: "D", to: { x: -2, y: 3 } }] });
    expect(r.ok).toBe(true);
  });

  it("rejects a destination that crosses a wall, leaving the document unchanged", () => {
    const make = () => docOf({
      joints: [["A", 0, 0], ["B", 0, 4], ["C", 2, 1], ["D", 2, 3]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const doc = deepFreeze(make());
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: -2, y: 1 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(doc).toEqual(make());
  });

  it("rejects merging joints and too-short walls", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 0.005 } }] }))
      .toMatchObject({ ok: false, error: { kind: "topology", message: "Wall too short" } });
  });

  it("reports missing joints and bad input", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "X", to: { x: 0, y: 0 } }] })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J1", to: { x: Number.NaN, y: 0 } }] })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(moveJoints(doc, { type: "moveJoints", moves: [] })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/move-joints.test.ts`
Expected: FAIL, because `../src/commands/move-joints` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/types.ts`:

```ts
import type { Point, Result } from "@fm/protocol";
import type { DomainError } from "../errors";
import type { Document, EntityRef } from "../model";
import type { DomainPatch } from "../patch";

export type JointRef = { existing: string } | { at: Point };

export type Command =
  | { type: "addWall"; opId: string; from: JointRef; to: JointRef }
  | { type: "moveJoints"; moves: { jointId: string; to: Point }[] }
  | { type: "setWallLength"; wallId: string; length: number; keep: "a" | "b" }
  | { type: "labelZone"; id: string; at: Point; name: string }
  | { type: "renameZone"; id: string; name: string }
  | { type: "deleteEntities"; ids: EntityRef[] };

export type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;
export type CommandResult = Result<{ doc: Document; patch: DomainPatch }, DomainError>;
```

and `packages/domain/src/commands/move-joints.ts`:

```ts
import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { domainError, topologyMessage, type DomainError } from "../errors";
import { incidentWalls } from "../graph";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

/**
 * Moves joints to new positions and validates the result. Only the destination matters (spec §3.4):
 * an invalid result is a "topology" error and the document is unchanged.
 */
export function applyMoves(doc: Document, moves: { jointId: string; to: Point }[]): Result<Document, DomainError> {
  if (moves.length === 0) return err(domainError("invalidInput", "Nothing to move"));
  const joints = { ...doc.joints };
  for (const m of moves) {
    if (!isValidId(m.jointId) || !doc.joints[m.jointId]) return err(domainError("notFound", "Joint not found"));
    if (!isFiniteNumber(m.to.x) || !isFiniteNumber(m.to.y)) return err(domainError("invalidInput", "Invalid position"));
    joints[m.jointId] = { id: m.jointId, x: m.to.x, y: m.to.y };
  }
  const next: Document = { ...doc, joints };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("topology", topologyMessage(valid.error), valid.error));
  return ok(next);
}

export function moveJoints(doc: Document, cmd: CommandOf<"moveJoints">): CommandResult {
  const moved = applyMoves(doc, cmd.moves);
  if (!moved.ok) return moved;
  const deps: EntityKey[] = [];
  for (const m of cmd.moves) {
    deps.push({ table: "joints", id: m.jointId });
    for (const w of incidentWalls(doc, m.jointId)) deps.push({ table: "walls", id: w });
  }
  const patch = diffPatch(doc, moved.value, deps);
  return ok({ doc: moved.value, patch });
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/move-joints.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: moveJoints with destination-only validation"
```

### Task 2.8: `addWall` normalisation

**Files:** Create `packages/domain/src/commands/add-wall.ts`, `packages/domain/test/add-wall.test.ts`.

Spec §3.4 steps 1–4, in order:

```
from/to ──► resolve: joint within EPS? ─yes─► reuse it (dependency)
                     │ no
                     ▼
            wall body within EPS? ─yes─► split there: a-side keeps the wall ID,
                     │ no                  other side = op/w1 (op/w2 for `to`)
                     ▼
               new joint op/j0 (op/j1)
then: too short? → collinear overlap? → crossing except at own endpoints? → validateDocument
new wall = op/w0
```

Two choices are made here. **Ties:** distances within `1e-9` count as equal, so the smallest ID wins even with float noise. **Reused operation IDs:** if any entity already starts with `${opId}/`, the command is refused rather than overwriting it.

- [x] **Step 1: Write the failing test** `packages/domain/test/add-wall.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addWall } from "../src/commands/add-wall";
import type { JointRef } from "../src/commands/types";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

const at = (x: number, y: number): JointRef => ({ at: { x, y } });
function add(doc: Document, opId: string, from: JointRef, to: JointRef) {
  return addWall(doc, { type: "addWall", opId, from, to });
}
function ok(doc: Document, opId: string, from: JointRef, to: JointRef) {
  const r = add(doc, opId, from, to);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("addWall", () => {
  it("creates a free wall with IDs op/j0, op/j1, op/w0", () => {
    const { doc, patch } = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    expect(doc.joints).toEqual({ "op1/j0": { id: "op1/j0", x: 0, y: 0 }, "op1/j1": { id: "op1/j1", x: 6, y: 0 } });
    expect(doc.walls).toEqual({ "op1/w0": { id: "op1/w0", a: "op1/j0", b: "op1/j1" } });
    expect(patch.deletes).toEqual([]);
    expect(patch.dependencies).toEqual([]);
  });

  it("reuses a joint within EPS and records it as a dependency", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    const { doc, patch } = ok(first.doc, "op2", at(6.0004, 0), at(6, 4));
    expect(doc.walls["op2/w0"]).toEqual({ id: "op2/w0", a: "op1/j1", b: "op2/j0" });
    expect(patch.dependencies).toEqual([{ table: "joints", id: "op1/j1" }]);
  });

  it("accepts an existing-joint reference", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    const { doc } = ok(first.doc, "op2", { existing: "op1/j0" }, at(0, 4));
    expect(doc.walls["op2/w0"]?.a).toBe("op1/j0");
    expect(add(first.doc, "op3", { existing: "nope" }, at(1, 1))).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("splits a wall at a T-junction; the a-side fragment keeps the wall's ID", () => {
    const room = rectDoc(0, 0, 6, 4); // W1: J1(0,0) → J2(6,0)
    const { doc, patch } = ok(room, "d", at(3, 0), at(3, 2));
    expect(doc.joints["d/j0"]).toEqual({ id: "d/j0", x: 3, y: 0 });
    expect(doc.walls.W1).toEqual({ id: "W1", a: "J1", b: "d/j0" });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2" });
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1" });
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" },
    ]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("splits both walls for the demo divider (3,0) → (3,4)", () => {
    const { doc } = ok(rectDoc(0, 0, 6, 4), "d", at(3, 0), at(3, 4));
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1" });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2" });   // from-side fragment of W1
    expect(doc.walls.W3).toEqual({ id: "W3", a: "J3", b: "d/j1" });          // W3: J3(6,4) → J4(0,4)
    expect(doc.walls["d/w2"]).toEqual({ id: "d/w2", a: "d/j1", b: "J4" });
  });

  it("projects a point within EPS of a wall onto it", () => {
    const { doc } = ok(rectDoc(0, 0, 6, 4), "d", at(3, 0.0004), at(3, 2));
    expect(doc.joints["d/j0"]).toEqual({ id: "d/j0", x: 3, y: 0 });
  });

  it("accepts a divider 0.30 m from a corner", () => {
    expect(add(rectDoc(0, 0, 6, 4), "d", at(0.3, 0), at(0.3, 4)).ok).toBe(true);
  });

  it("rejects a split that leaves a fragment under 1 cm, atomically", () => {
    const room = rectDoc(0, 0, 6, 4);
    const r = add(room, "d", at(0.005, 0), at(0.005, 2));
    expect(r).toMatchObject({ ok: false, error: { kind: "tooShort", message: "Intersection would create a wall shorter than 1 cm" } });
    expect(Object.keys(room.walls)).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("rejects a wall shorter than 1 cm", () => {
    expect(add({ joints: {}, walls: {}, zoneLabels: {} }, "x", at(0, 0), at(0.005, 0)))
      .toMatchObject({ ok: false, error: { kind: "tooShort", message: "Wall too short" } });
  });

  it("rejects collinear overlap", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(add(room, "x", at(-2, 0), at(2, 0))).toMatchObject({ ok: false, error: { kind: "overlap", message: "Walls can't overlap" } });
    expect(add(room, "x", at(1, 0), at(2, 0))).toMatchObject({ ok: false, error: { kind: "overlap" } });
    expect(add(room, "x", at(3, 0), { existing: "J2" })).toMatchObject({ ok: false, error: { kind: "overlap" } });
  });

  it("rejects interior crossings and passing through a joint", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(add(room, "x", at(3, -1), at(3, 1))).toMatchObject({ ok: false, error: { kind: "crossing", message: "Walls can't cross" } });
    expect(add(room, "x", at(-1, -1), at(1, 1))).toMatchObject({ ok: false, error: { kind: "crossing" } });
  });

  it("refuses a reused operation ID", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    expect(add(first.doc, "op1", at(0, 5), at(6, 5))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("breaks equal-distance joint ties by ID", () => {
    const off = 3 / 4096; // exact in binary: both joints are 0.73 mm from x = 1 and 1.46 mm apart
    const doc = docOf({
      joints: [["B", 1 + off, 0], ["A", 1 - off, 0], ["C", 1 + off, 5], ["D", 1 - off, -5]],
      walls: [["W1", "B", "C"], ["W2", "A", "D"]],
    });
    const { doc: next } = ok(doc, "x", at(1, 0), at(-5, 0));
    expect(next.walls["x/w0"]?.a).toBe("A");
  });

  it("gives identical results whatever the tables' insertion order", () => {
    const forward = rectDoc(0, 0, 6, 4);
    const reversed: Document = {
      joints: Object.fromEntries(Object.entries(forward.joints).reverse()),
      walls: Object.fromEntries(Object.entries(forward.walls).reverse()),
      zoneLabels: {},
    };
    const a = ok(forward, "d", at(3, 0), at(3, 4));
    const b = ok(reversed, "d", at(3, 0), at(3, 4));
    expect(b.doc).toEqual(a.doc);
    expect(b.patch).toEqual(a.patch);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/add-wall.test.ts`
Expected: FAIL, because `../src/commands/add-wall` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/add-wall.ts`:

```ts
import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { distance, projectOnSegment, segmentIntersection } from "../geometry";
import { sortedIds, wallEnds } from "../graph";
import { EPS, MIN_EDGE, type Document, type Joint, type Wall } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult, JointRef } from "./types";

/** Distances closer than this count as equal, so float noise cannot reorder a tie. */
const TIE = 1e-9;

type Resolved =
  | { kind: "joint"; jointId: string; point: Point }
  | { kind: "new"; point: Point }
  | { kind: "split"; wallId: string; point: Point };

/**
 * §3.4 step 1: a point within EPS of a joint becomes that joint; otherwise a point within EPS of a
 * wall body splits that wall at the closest point. Entities are inspected in ID order; on equal
 * distances (within TIE) the smallest ID wins.
 */
function resolve(doc: Document, ref: JointRef): Result<Resolved, DomainError> {
  if ("existing" in ref) {
    const j = isValidId(ref.existing) ? doc.joints[ref.existing] : undefined; // revised in wave 2: never index a table with an unchecked ID
    return j ? ok({ kind: "joint", jointId: j.id, point: { x: j.x, y: j.y } }) : err(domainError("notFound", "Joint not found"));
  }
  const p = ref.at;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return err(domainError("invalidInput", "Invalid position"));
  let joint: { id: string; d: number } | null = null;
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    if (!j) continue;
    const d = distance(p, j);
    if (d < EPS && (!joint || d < joint.d - TIE)) joint = { id, d };
  }
  if (joint) {
    const j = doc.joints[joint.id];
    if (j) return ok({ kind: "joint", jointId: j.id, point: { x: j.x, y: j.y } });
  }
  let wall: { id: string; d: number; point: Point } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    if (!ends) continue;
    const q = projectOnSegment(p, ends.a, ends.b).point;
    const d = distance(p, q);
    if (d < EPS && (!wall || d < wall.d - TIE)) wall = { id, d, point: q };
  }
  if (wall) return ok({ kind: "split", wallId: wall.id, point: wall.point });
  return ok({ kind: "new", point: { x: p.x, y: p.y } });
}

/**
 * addWall normalisation (spec §3.4): resolve endpoints, split walls at T-junctions, reject collinear
 * overlap and interior crossings, validate. IDs: the new wall is `${opId}/w0`, split fragments
 * `${opId}/w1`…, new joints `${opId}/j0`…, in from-then-to order. A split wall keeps its ID on the
 * fragment next to its original `a` endpoint.
 */
export function addWall(doc: Document, cmd: CommandOf<"addWall">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > 120) return err(domainError("invalidInput", "Invalid operation ID"));
  const prefix = `${cmd.opId}/`;
  if ([...Object.keys(doc.joints), ...Object.keys(doc.walls)].some((id) => id.startsWith(prefix))) {
    return err(domainError("invalidInput", "Operation ID already used"));
  }
  const from = resolve(doc, cmd.from);
  if (!from.ok) return from;
  const to = resolve(doc, cmd.to);
  if (!to.ok) return to;
  if (distance(from.value.point, to.value.point) < MIN_EDGE) return err(domainError("tooShort", MESSAGES.tooShort));
  if (from.value.kind === "split" && to.value.kind === "split" && from.value.wallId === to.value.wallId) {
    return err(domainError("overlap", MESSAGES.overlap));
  }

  const joints: Record<string, Joint> = { ...doc.joints };
  const walls: Record<string, Wall> = { ...doc.walls };
  const deps: EntityKey[] = [];
  let nextJoint = 0;
  let nextWall = 1;

  const place = (r: Resolved): Result<string, DomainError> => {
    switch (r.kind) {
      case "joint":
        deps.push({ table: "joints", id: r.jointId });
        return ok(r.jointId);
      case "new": {
        const id = `${prefix}j${nextJoint++}`;
        joints[id] = { id, x: r.point.x, y: r.point.y };
        return ok(id);
      }
      case "split": {
        const wall = doc.walls[r.wallId];
        const a = wall && doc.joints[wall.a];
        const b = wall && doc.joints[wall.b];
        if (!wall || !a || !b) return err(domainError("notFound", "Wall not found"));
        if (distance(a, r.point) < MIN_EDGE || distance(r.point, b) < MIN_EDGE) {
          return err(domainError("tooShort", MESSAGES.splitTooShort));
        }
        const id = `${prefix}j${nextJoint++}`;
        const fragment = `${prefix}w${nextWall++}`;
        joints[id] = { id, x: r.point.x, y: r.point.y };
        walls[wall.id] = { id: wall.id, a: wall.a, b: id };
        walls[fragment] = { id: fragment, a: id, b: wall.b };
        deps.push({ table: "walls", id: wall.id }, { table: "joints", id: wall.a }, { table: "joints", id: wall.b });
        return ok(id);
      }
      default:
        return assertNever(r);
    }
  };

  const a = place(from.value);
  if (!a.ok) return a;
  const b = place(to.value);
  if (!b.ok) return b;
  const wallId = `${prefix}w0`;
  walls[wallId] = { id: wallId, a: a.value, b: b.value };
  const next: Document = { ...doc, joints, walls };
  const pa = joints[a.value];
  const pb = joints[b.value];
  if (!pa || !pb) return err(domainError("notFound", "Joint not found"));

  const others = sortedIds(walls).filter((id) => id !== wallId);
  // §3.4 step 2: collinear overlap.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const sharesBoth = (o.a === a.value || o.a === b.value) && (o.b === a.value || o.b === b.value);
    if (sharesBoth || segmentIntersection(pa, pb, ends.a, ends.b).kind === "overlap") {
      return err(domainError("overlap", MESSAGES.overlap));
    }
  }
  // §3.4 step 3: the new wall may touch other walls only at its own endpoints' joints.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const hit = segmentIntersection(pa, pb, ends.a, ends.b);
    if (hit.kind !== "point") continue;
    const shared = [a.value, b.value].find((j) => j === o.a || j === o.b);
    const sharedPoint = shared === undefined ? undefined : joints[shared];
    if (!sharedPoint || distance(hit.point, sharedPoint) >= EPS) return err(domainError("crossing", MESSAGES.crossing));
  }
  // §3.4 step 4.
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/add-wall.test.ts`
Expected: PASS (14 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: addWall resolves endpoints, splits at T-junctions, rejects overlap and crossings"
```

### Task 2.9: `setWallLength`

**Files:** Create `packages/domain/src/commands/set-wall-length.ts`, `packages/domain/test/set-wall-length.test.ts`.

The non-kept joint moves along the wall's direction. Other walls on that joint follow because they reference it ("keeps connections"). Dependencies are the wall, both endpoints and the walls incident to the moving endpoint (§4.1). Demo step 5 is the first test.

- [x] **Step 1: Write the failing test** `packages/domain/test/set-wall-length.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { setWallLength } from "../src/commands/set-wall-length";
import { rectDoc } from "./helpers";

describe("setWallLength", () => {
  it("keeps endpoint a and moves b along the wall; connected walls follow", () => {
    const doc = rectDoc(0, 0, 6, 4); // W2: J2(6,0) → J3(6,4)
    const r = setWallLength(doc, { type: "setWallLength", wallId: "W2", length: 3.5, keep: "a" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J3).toEqual({ id: "J3", x: 6, y: 3.5 });
    expect(r.value.doc.walls.W3).toEqual(doc.walls.W3); // W3 still uses J3, so it follows
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" },
    ]);
  });

  it("keeps endpoint b when asked", () => {
    const r = setWallLength(rectDoc(0, 0, 6, 4), { type: "setWallLength", wallId: "W1", length: 5, keep: "b" });
    expect(r.ok && r.value.doc.joints.J1).toEqual({ id: "J1", x: 1, y: 0 });
  });

  it("rejects too-short, invalid and topology-breaking lengths", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(setWallLength(doc, { type: "setWallLength", wallId: "W2", length: 0.005, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "tooShort" } });
    expect(setWallLength(doc, { type: "setWallLength", wallId: "W2", length: -1, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(setWallLength(doc, { type: "setWallLength", wallId: "nope", length: 1, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/set-wall-length.test.ts`
Expected: FAIL, because `../src/commands/set-wall-length` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/set-wall-length.ts`:

```ts
import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { add, normalize, scale, sub } from "../geometry";
import { incidentWalls } from "../graph";
import { MIN_EDGE, type Document } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber } from "../shape";
import { applyMoves } from "./move-joints";
import type { CommandOf, CommandResult } from "./types";

/** Moves the non-kept endpoint along the wall; walls sharing that joint follow (spec §3.4). */
export function setWallLength(doc: Document, cmd: CommandOf<"setWallLength">): CommandResult {
  const wall = doc.walls[cmd.wallId];
  if (!wall) return err(domainError("notFound", "Wall not found"));
  if (!isFiniteNumber(cmd.length) || cmd.length <= 0) return err(domainError("invalidInput", "Invalid length"));
  if (cmd.length < MIN_EDGE) return err(domainError("tooShort", MESSAGES.tooShort));
  const keptId = cmd.keep === "a" ? wall.a : wall.b;
  const movingId = cmd.keep === "a" ? wall.b : wall.a;
  const kept = doc.joints[keptId];
  const moving = doc.joints[movingId];
  if (!kept || !moving) return err(domainError("notFound", "Joint not found"));
  const dir = normalize(sub(moving, kept));
  if (!dir) return err(domainError("invalid", MESSAGES.invalid));
  const moved = applyMoves(doc, [{ jointId: movingId, to: add(kept, scale(dir, cmd.length)) }]);
  if (!moved.ok) return moved;
  const deps: EntityKey[] = [
    { table: "walls", id: wall.id },
    { table: "joints", id: keptId },
    { table: "joints", id: movingId },
    ...incidentWalls(doc, movingId).map((id): EntityKey => ({ table: "walls", id })),
  ];
  return ok({ doc: moved.value, patch: diffPatch(doc, moved.value, deps) });
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/set-wall-length.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: setWallLength keeps one endpoint and connections"
```

### Task 2.10: Wall outlines (mitered joins)

**Files:** Create `packages/domain/src/queries/outlines.ts`, `packages/domain/test/outlines.test.ts`.

At each joint the incident walls are sorted counter-clockwise. A wall's **left** edge (seen leaving the joint) meets the **right** edge of the next wall counter-clockwise; its right edge meets the left edge of the previous one. Each wall's polygon is built counter-clockwise as:

```
[A.left…, reverse(A.right)…, B.left…, reverse(B.right)…]
        B.right(top) ◄──────────── A.left(top)
            │     wall A → B, seen from A      ▲
            ▼                                  │
        B.left(bottom) ───────────► A.right(bottom)
```

There are four cases:
- **Degree 1:** a flat end at the joint (README P5).
- **Straight through:** a 180° gap; the offset edges continue.
- **Reflex gap with a far tip:** when the gap is over 180° and the miter tip is more than 4 × half-thickness from the joint, the corner becomes a bevel. Each wall contributes its own edge point plus the midpoint of the two edge points, so the two polygons share an edge and leave no hole.
- **Inner corners:** never limited.

- [x] **Step 1: Write the failing test** `packages/domain/test/outlines.test.ts` (worked numbers: an L corner meets at outer (4.1, −0.1) and inner (3.9, 0.1); a T-junction stem meets the through-wall at x = 2.9 and 3.1):

```ts
import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { wallOutlines } from "../src/queries/outlines";
import { docOf } from "./helpers";

const close = (points: { x: number; y: number }[] | undefined) =>
  (points ?? []).map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }));

describe("wallOutlines", () => {
  it("gives a lone wall flat ends at its joints", () => {
    const doc = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W", "A", "B"]] });
    expect(close(wallOutlines(doc).get("W"))).toEqual([
      { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 4, y: -0.1 }, { x: 4, y: 0.1 },
    ]);
  });

  it("miters an L corner: outer (4.1, -0.1), inner (3.9, 0.1)", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"]],
    });
    const out = wallOutlines(doc);
    expect(close(out.get("W1"))).toEqual([
      { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 4.1, y: -0.1 }, { x: 3.9, y: 0.1 },
    ]);
    expect(close(out.get("W2"))).toContainEqual({ x: 4.1, y: -0.1 });
    expect(close(out.get("W2"))).toContainEqual({ x: 3.9, y: 0.1 });
  });

  it("joins a T-junction: straight-through edge at y = -0.1, corners at x = 2.9 and 3.1", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["S", 3, 0], ["B", 6, 0], ["T", 3, 4]],
      walls: [["L", "A", "S"], ["R", "S", "B"], ["D", "S", "T"]],
    });
    const out = wallOutlines(doc);
    expect(close(out.get("R"))).toEqual([
      { x: 3.1, y: 0.1 }, { x: 3, y: -0.1 }, { x: 6, y: -0.1 }, { x: 6, y: 0.1 },
    ]);
    expect(close(out.get("L"))).toContainEqual({ x: 2.9, y: 0.1 });
    expect(close(out.get("L"))).toContainEqual({ x: 3, y: -0.1 });
    expect(close(out.get("D"))).toEqual([
      { x: 2.9, y: 0.1 }, { x: 3.1, y: 0.1 }, { x: 3.1, y: 4 }, { x: 2.9, y: 4 },
    ]);
  });

  it("returns counter-clockwise polygons", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3], ["D", 0, 3]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"], ["W4", "D", "A"]],
    });
    for (const poly of wallOutlines(doc).values()) expect(signedArea(poly)).toBeGreaterThan(0);
  });

  it("bevels a sharp 20° corner and both walls share the bevel midpoint", () => {
    const a = (20 * Math.PI) / 180;
    const doc = docOf({
      joints: [["J", 0, 0], ["P", 5, 0], ["Q", 5 * Math.cos(a), 5 * Math.sin(a)]],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"]],
    });
    const out = wallOutlines(doc);
    const w1 = close(out.get("W1"));
    const w2 = close(out.get("W2"));
    expect(w1).toHaveLength(5);
    expect(w2).toHaveLength(5);
    expect(w1).toContainEqual({ x: 0, y: -0.1 });
    const shared = w1.filter((p) => w2.some((q) => q.x === p.x && q.y === p.y));
    expect(shared.length).toBeGreaterThanOrEqual(2); // the inner corner and the bevel midpoint
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/outlines.test.ts`
Expected: FAIL, because `../src/queries/outlines` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/queries/outlines.ts`:

```ts
import type { Point } from "@fm/protocol";
import { add, distance, lineIntersection, normalize, perpLeft, scale, sub } from "../geometry";
import { jointWalls, sortedIds, wallEnds } from "../graph";
import { WALL_THICKNESS, type Document } from "../model";

const HALF = WALL_THICKNESS / 2;
const MITER_LIMIT = 4; // a miter tip farther than 4 · HALF from the joint becomes a bevel

type Spoke = { wallId: string; dir: Point; angle: number };

/** Walls leaving a joint, sorted counter-clockwise by angle. */
function spokes(doc: Document, jointId: string, wallIds: string[]): Spoke[] {
  const j = doc.joints[jointId];
  if (!j) return [];
  const out: Spoke[] = [];
  for (const wallId of wallIds) {
    const w = doc.walls[wallId];
    const other = w && doc.joints[w.a === jointId ? w.b : w.a];
    const dir = other ? normalize(sub(other, j)) : null;
    if (dir) out.push({ wallId, dir, angle: Math.atan2(dir.y, dir.x) });
  }
  return out.sort((p, q) => p.angle - q.angle || (p.wallId < q.wallId ? -1 : 1));
}

/** Counter-clockwise angle from direction u to direction v, in (0, 2π]. */
function ccwAngle(u: Point, v: Point): number {
  const a = Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x);
  const r = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return r === 0 ? 2 * Math.PI : r;
}

/**
 * Corner points of one side of a wall at joint j, edge point first.
 * side +1: the wall's left edge (seen leaving j) meets the right edge of the next wall counter-clockwise.
 * side −1: the wall's right edge meets the left edge of the next wall clockwise.
 */
function corner(j: Point, me: Spoke, neighbour: Spoke | null, side: 1 | -1): Point[] {
  const nMe = perpLeft(me.dir);
  const own = add(j, scale(nMe, side * HALF));
  if (!neighbour || neighbour.wallId === me.wallId) return [own]; // flat end (spec §3.5)
  const gap = side === 1 ? ccwAngle(me.dir, neighbour.dir) : ccwAngle(neighbour.dir, me.dir);
  if (Math.abs(gap - Math.PI) < 1e-9) return [own]; // straight through: continuous edges
  const other = add(j, scale(perpLeft(neighbour.dir), -side * HALF));
  const tip = lineIntersection(own, me.dir, other, neighbour.dir);
  if (!tip) return [own];
  if (gap > Math.PI && distance(tip, j) > MITER_LIMIT * HALF) {
    // Bevel: both walls share the midpoint of their two edge points, so no gap remains.
    return [own, scale(add(own, other), 0.5)];
  }
  return [tip];
}

/**
 * One counter-clockwise polygon per wall with mitered joins (spec §3.5): at each joint the incident
 * walls are sorted by angle and each wall's edge meets the facing edge of its angular neighbour.
 */
export function wallOutlines(doc: Document): Map<string, Point[]> {
  const byJoint = jointWalls(doc);
  const cache = new Map<string, Spoke[]>();
  const spokesAt = (jointId: string): Spoke[] => {
    let s = cache.get(jointId);
    if (!s) {
      s = spokes(doc, jointId, byJoint.get(jointId) ?? []);
      cache.set(jointId, s);
    }
    return s;
  };
  const sides = (jointId: string, wallId: string): { left: Point[]; right: Point[] } | null => {
    const j = doc.joints[jointId];
    const list = spokesAt(jointId);
    const i = list.findIndex((s) => s.wallId === wallId);
    const me = list[i];
    if (!j || !me) return null;
    const next = list[(i + 1) % list.length] ?? null;
    const prev = list[(i - 1 + list.length) % list.length] ?? null;
    return { left: corner(j, me, next, 1), right: corner(j, me, prev, -1) };
  };

  const out = new Map<string, Point[]>();
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (!w || !wallEnds(doc, id)) continue;
    const atA = sides(w.a, id);
    const atB = sides(w.b, id);
    if (!atA || !atB) continue;
    out.set(id, [...atA.left, ...[...atA.right].reverse(), ...atB.left, ...[...atB.right].reverse()]);
  }
  return out;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/outlines.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: mitered wall outlines with flat ends and bevels"
```

### Task 2.11: Faces of the wall graph

**Files:** Create `packages/domain/src/queries/faces.ts`, `packages/domain/test/faces.test.ts`.

Spec §3.6 steps 1–3. The face walk uses the rule "arrive at v along u→v, leave by the edge just clockwise of v→u". The interior of every walk is therefore on its left: bounded faces are counter-clockwise (positive area, y up), and each component's exterior is clockwise and dropped. This works per component, so free-standing groups need no special case.

```
   J4 ●◄────────● J3      walk from J1→J2: at J2 the edges are
      │  face   ▲          [to J3 at 90°, to J1 at 180°]; the twin J2→J1 is
      ▼  (CCW)  │          at index 1, so leave by index 0 → J2→J3 (a left turn)
   J1 ●────────►● J2
```

Bridges (dangling walls) are found by checking whether a wall's endpoints stay connected without it. The cost is O(E·(V+E)), which is fine for hundreds of walls. `boundedFaces` stays internal; `zones` wraps it.

- [x] **Step 1: Write the failing test** `packages/domain/test/faces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boundedFaces } from "../src/queries/faces";
import { docOf, rectDoc } from "./helpers";

describe("boundedFaces", () => {
  it("finds one counter-clockwise face in a rectangle and drops the exterior", () => {
    const faces = boundedFaces(rectDoc(0, 0, 6, 4));
    expect(faces).toHaveLength(1);
    expect(faces[0]?.centreArea).toBe(24);
    expect(faces[0]?.simple).toBe(true);
    expect([...(faces[0]?.wallIds ?? [])].sort()).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("splits a room in two with a divider", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
      walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    });
    const faces = boundedFaces(doc);
    expect(faces.map((f) => f.centreArea)).toEqual([12, 12]);
    expect(faces.every((f) => f.wallIds.includes("D"))).toBe(true);
  });

  it("ignores dangling walls (bridges)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T", 3, 1]],
      walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["R", "J2", "J3"], ["Top", "J3", "J4"], ["L", "J4", "J1"], ["Stub", "S", "T"]],
    });
    const faces = boundedFaces(doc);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.wallIds).not.toContain("Stub");
  });

  it("handles separate components, each with its own exterior", () => {
    const a = rectDoc(0, 0, 2, 2);
    const doc = docOf({
      joints: [["K1", 5, 0], ["K2", 7, 0], ["K3", 7, 2], ["K4", 5, 2]],
      walls: [["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"]],
    });
    const faces = boundedFaces({ joints: { ...a.joints, ...doc.joints }, walls: { ...a.walls, ...doc.walls }, zoneLabels: {} });
    expect(faces.map((f) => f.centreArea)).toEqual([4, 4]);
  });

  it("ignores walks smaller than 0.01 m²", () => {
    expect(boundedFaces(rectDoc(0, 0, 0.05, 0.1))).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/faces.test.ts`
Expected: FAIL, because `../src/queries/faces` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/queries/faces.ts`:

```ts
import type { Point } from "@fm/protocol";
import { signedArea } from "../geometry";
import { sortedIds } from "../graph";
import { MIN_FACE_AREA, type Document } from "../model";

export type Face = { key: string; jointIds: string[]; wallIds: string[]; ring: Point[] };
export type BoundedFace = Face & { simple: boolean; centreArea: number };

type Edge = { wallId: string; a: string; b: string };

/** Walls whose removal disconnects their endpoints: they belong to no cycle (spec §3.6 step 1). */
function bridges(edges: Edge[]): Set<string> {
  const adjacent = new Map<string, Edge[]>();
  for (const e of edges) {
    adjacent.set(e.a, [...(adjacent.get(e.a) ?? []), e]);
    adjacent.set(e.b, [...(adjacent.get(e.b) ?? []), e]);
  }
  const out = new Set<string>();
  for (const e of edges) {
    const seen = new Set<string>([e.a]);
    const stack = [e.a];
    for (let v = stack.pop(); v !== undefined && !seen.has(e.b); v = stack.pop()) {
      for (const f of adjacent.get(v) ?? []) {
        if (f.wallId === e.wallId) continue;
        const w = f.a === v ? f.b : f.a;
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    if (!seen.has(e.b)) out.add(e.wallId);
  }
  return out;
}

type HalfEdge = { from: string; to: string; wallId: string; angle: number };

/**
 * Bounded faces of the wall graph (spec §3.6 steps 1–3). Bridges are ignored. Face boundaries are
 * walked with the interior on the left, so bounded faces run counter-clockwise (y up) and each
 * component's exterior runs clockwise and is dropped. Walks smaller than MIN_FACE_AREA are ignored.
 * A face whose walk repeats a joint is not simple: it has no area and holds no labels.
 */
export function boundedFaces(doc: Document): BoundedFace[] {
  const edges: Edge[] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (w && doc.joints[w.a] && doc.joints[w.b] && w.a !== w.b) edges.push({ wallId: id, a: w.a, b: w.b });
  }
  const cut = bridges(edges);
  const outgoing = new Map<string, HalfEdge[]>();
  const angleOf = (from: string, to: string): number => {
    const p = doc.joints[from];
    const q = doc.joints[to];
    return p && q ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
  };
  for (const e of edges) {
    if (cut.has(e.wallId)) continue;
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]] as const) {
      const list = outgoing.get(from) ?? [];
      list.push({ from, to, wallId: e.wallId, angle: angleOf(from, to) });
      outgoing.set(from, list);
    }
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  // Turning rule: after arriving at v along u→v, leave by the edge just clockwise of v→u.
  const next = (h: HalfEdge): HalfEdge | undefined => {
    const list = outgoing.get(h.to) ?? [];
    const i = list.findIndex((x) => x.to === h.from && x.wallId === h.wallId);
    return list[(i - 1 + list.length) % list.length];
  };

  const visited = new Set<string>();
  const faces: BoundedFace[] = [];
  const halfKey = (h: HalfEdge): string => `${h.wallId}:${h.from}`;
  for (const start of [...outgoing.keys()].sort()) {
    for (const h0 of outgoing.get(start) ?? []) {
      if (visited.has(halfKey(h0))) continue;
      const jointIds: string[] = [];
      const wallIds: string[] = [];
      let h: HalfEdge | undefined = h0;
      while (h && !visited.has(halfKey(h))) {
        visited.add(halfKey(h));
        jointIds.push(h.from);
        wallIds.push(h.wallId);
        h = next(h);
      }
      const ring = jointIds.map((id) => {
        const j = doc.joints[id];
        return { x: j?.x ?? 0, y: j?.y ?? 0 };
      });
      const area = signedArea(ring);
      if (area < MIN_FACE_AREA) continue;
      faces.push({
        key: [...wallIds].sort().join("|"),
        jointIds,
        wallIds,
        ring,
        simple: new Set(jointIds).size === jointIds.length,
        centreArea: area,
      });
    }
  }
  return faces.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/faces.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: bounded faces by face walk, ignoring bridges"
```

### Task 2.12: Clear floor area (inset)

**Files:** Create `packages/domain/src/queries/area.ts`, `packages/domain/test/area.test.ts`.

Spec §3.6 steps 4–5. Every edge is offset by 0.10 m to its left, which for a counter-clockwise ring is inward; consecutive offset lines are intersected. The result is accepted only when three conditions hold:
- every inset edge keeps its source direction (positive dot product and positive length);
- the polygon has positive area;
- the polygon is simple.

The direction check is what catches the flipped 0.10 m square (design-memory Don't). Merging collinear vertices first keeps a straight split wall's area unchanged.

- [x] **Step 1: Write the failing test** `packages/domain/test/area.test.ts` (worked number: the left demo room (0,0),(3,0),(3,4),(0,4) insets to 2.8 × 3.8 = 10.64 m²):

```ts
import { describe, expect, it } from "vitest";
import { insetFloor } from "../src/queries/area";

const p = (x: number, y: number) => ({ x, y });

describe("insetFloor", () => {
  it("demo left room: ring (0,0),(3,0),(3,4),(0,4) → 2.8 × 3.8 = 10.64 m²", () => {
    const r = insetFloor([p(0, 0), p(3, 0), p(3, 4), p(0, 4)]);
    expect(r?.area).toBeCloseTo(10.64, 9);
    expect(r?.floor.map((q) => ({ x: +q.x.toFixed(9), y: +q.y.toFixed(9) }))).toEqual([p(0.1, 0.1), p(2.9, 0.1), p(2.9, 3.9), p(0.1, 3.9)]);
  });

  it("merges collinear boundary vertices (a straight split wall keeps the same area)", () => {
    const plain = insetFloor([p(0, 0), p(6, 0), p(6, 4), p(0, 4)]);
    const split = insetFloor([p(0, 0), p(3, 0), p(6, 0), p(6, 4), p(0, 4)]);
    expect(split?.area).toBeCloseTo(plain?.area ?? 0, 9);
    expect(plain?.area).toBeCloseTo(5.8 * 3.8, 9);
  });

  it("handles a sloped wall", () => {
    const r = insetFloor([p(3, 0), p(6, 0), p(6, 3.5), p(3, 4)]);
    expect(r?.area).toBeGreaterThan(9);
    expect(r?.area).toBeLessThan(10.64);
  });

  it("declines a room too narrow for its walls", () => {
    expect(insetFloor([p(0, 0), p(0.15, 0), p(0.15, 3), p(0, 3)])).toBeNull();
  });

  it("declines a 0.10 m square whose inset flips to a positive-area square (edge-direction check)", () => {
    // Inset lines of a 0.1 m square with 0.1 m offsets meet at a flipped square of positive area;
    // the direction check rejects it (design-memory Don't).
    expect(insetFloor([p(0, 0), p(0.1, 0), p(0.1, 0.1), p(0, 0.1)])).toBeNull();
  });

  it("declines a boundary that folds back on itself", () => {
    expect(insetFloor([p(0, 0), p(4, 0), p(2, 0), p(2, 3)])).toBeNull();
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/area.test.ts`
Expected: FAIL, because `../src/queries/area` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/queries/area.ts`:

```ts
import type { Point } from "@fm/protocol";
import { add, cross, dot, isSimplePolygon, length, lineIntersection, normalize, perpLeft, scale, signedArea, sub } from "../geometry";
import { WALL_THICKNESS } from "../model";

export const AREA_UNAVAILABLE = "Area unavailable: unsupported geometry";

/** Drops vertices between collinear boundary segments that continue in the same direction. */
function mergeCollinear(ring: Point[]): Point[] | null {
  let points = ring;
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const cur = points[i];
      const nxt = points[(i + 1) % points.length];
      if (!prev || !cur || !nxt) return null;
      const u = sub(cur, prev);
      const v = sub(nxt, cur);
      if (Math.abs(cross(u, v)) > 1e-9 * length(u) * length(v)) continue;
      if (dot(u, v) < 0) return null; // the boundary folds back on itself
      points = points.filter((_, k) => k !== i);
      changed = true;
      break;
    }
  }
  return points.length >= 3 ? points : null;
}

/**
 * Clear floor polygon of a counter-clockwise centreline ring (spec §3.6 steps 4–5): offset every
 * boundary line inward by WALL_THICKNESS / 2 and intersect consecutive lines. Accepted only when the
 * result is simple, has positive area and every inset edge keeps its source direction.
 */
export function insetFloor(ring: Point[]): { floor: Point[]; area: number } | null {
  const pts = mergeCollinear(ring);
  if (!pts) return null;
  const n = pts.length;
  const half = WALL_THICKNESS / 2;
  const lines: { p: Point; d: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = a && b ? normalize(sub(b, a)) : null;
    if (!a || !d) return null;
    lines.push({ p: add(a, scale(perpLeft(d), half)), d });
  }
  const floor: Point[] = [];
  for (let i = 0; i < n; i++) {
    const before = lines[(i - 1 + n) % n];
    const here = lines[i];
    const q = before && here ? lineIntersection(before.p, before.d, here.p, here.d) : null;
    if (!q) return null;
    floor.push(q);
  }
  for (let i = 0; i < n; i++) {
    const a = floor[i];
    const b = floor[(i + 1) % n];
    const src = lines[i];
    if (!a || !b || !src) return null;
    const e = sub(b, a);
    if (length(e) <= 1e-9 || dot(e, src.d) <= 0) return null;
  }
  const area = signedArea(floor);
  if (area <= 0 || !isSimplePolygon(floor)) return null;
  return { floor, area };
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/area.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: clear floor polygon by inward offset with direction check"
```

### Task 2.13: Zones, `faceAt` and orphan labels

**Files:** Create `packages/domain/src/queries/zones.ts`, `packages/domain/test/zones.test.ts`.

(revised 2026-09-28 after the wave 1 code review: `Face` fields are `readonly` since the fix commit, and `Zone`, `zones()` and `orphanLabelIds()` are read-only too, because one cached analysis per document is shared by every caller. The test copies before sorting.)

A label belongs to the **smallest** simple face that contains its point and is not within `EPS` of that face's boundary. That handles a free-standing room inside another. A face whose walk repeats a joint gets `"Area unavailable: unsupported boundary"` and holds no labels; failed insets get `AREA_UNAVAILABLE`. Results are memoized in a `WeakMap` keyed by document identity. That only avoids recomputation within one editor state (design-memory Don't).

A face `key` is its sorted wall IDs joined by `|`. It identifies a face within one document state only; zones have no identity across edits (labels do).

- [x] **Step 1: Write the failing test** `packages/domain/test/zones.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { faceAt, orphanLabelIds, zones } from "../src/queries/zones";
import { docOf, rectDoc } from "./helpers";

const divided = () =>
  docOf({
    joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    labels: [["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"], ["L9", 20, 20, "Lost"]],
  });

describe("zones", () => {
  it("gives each demo room 10.64 m² and resolves labels by containment", () => {
    const z = zones(divided());
    expect(z.map((x) => x.area?.toFixed(2))).toEqual(["10.64", "10.64"]);
    expect(z.flatMap((x) => x.labelIds).sort()).toEqual(["L1", "L2"]);
    expect(orphanLabelIds(divided())).toEqual(["L9"]);
  });

  it("memoizes by document identity", () => {
    const doc = divided();
    expect(zones(doc)).toBe(zones(doc));
  });

  it("reports unavailable area without failing", () => {
    const narrow = rectDoc(0, 0, 0.15, 3);
    const [z] = zones(narrow);
    expect(z?.area).toBeNull();
    expect(z?.unavailable).toBe("Area unavailable: unsupported geometry");
  });

  it("finds the face under a point, but not on a boundary or outside", () => {
    const doc = divided();
    expect(faceAt(doc, { x: 1, y: 1 })?.wallIds).toContain("D");
    expect(faceAt(doc, { x: 3, y: 2 })).toBeNull();
    expect(faceAt(doc, { x: 3.0005, y: 2 })).toBeNull();
    expect(faceAt(doc, { x: 9, y: 2 })).toBeNull();
  });

  it("prefers the innermost face for a free-standing room inside another", () => {
    const outer = rectDoc(0, 0, 10, 10);
    const inner = docOf({
      joints: [["K1", 4, 4], ["K2", 6, 4], ["K3", 6, 6], ["K4", 4, 6]],
      walls: [["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"]],
    });
    const doc = { joints: { ...outer.joints, ...inner.joints }, walls: { ...outer.walls, ...inner.walls }, zoneLabels: {} };
    expect([...(faceAt(doc, { x: 5, y: 5 })?.wallIds ?? [])].sort()).toEqual(["V1", "V2", "V3", "V4"]);
    expect([...(faceAt(doc, { x: 1, y: 1 })?.wallIds ?? [])].sort()).toEqual(["W1", "W2", "W3", "W4"]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/zones.test.ts`
Expected: FAIL, because `../src/queries/zones` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/queries/zones.ts`:

```ts
import type { Point } from "@fm/protocol";
import { distanceToSegment, pointInPolygon } from "../geometry";
import { sortedIds } from "../graph";
import { EPS, type Document } from "../model";
import { AREA_UNAVAILABLE, insetFloor } from "./area";
import { boundedFaces, type BoundedFace, type Face } from "./faces";

/** Cached per document and shared by every caller: read-only. */
export type Zone = {
  readonly face: Face;
  readonly floor: readonly Point[] | null;
  readonly area: number | null;
  readonly unavailable: string | null;
  readonly labelIds: readonly string[];
};

const UNSUPPORTED_BOUNDARY = "Area unavailable: unsupported boundary";

type Analysis = { faces: BoundedFace[]; zones: Zone[]; orphans: string[] };
const memo = new WeakMap<Document, Analysis>();

function publicFace(f: BoundedFace): Face {
  return { key: f.key, jointIds: f.jointIds, wallIds: f.wallIds, ring: f.ring };
}

function onBoundary(p: Point, ring: readonly Point[]): boolean {
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b !== undefined && distanceToSegment(p, a, b) < EPS;
  });
}

/** The smallest simple face strictly containing p (nested groups: the innermost room wins). */
function containingFace(faces: BoundedFace[], p: Point): BoundedFace | null {
  let best: BoundedFace | null = null;
  for (const f of faces) {
    if (!f.simple || onBoundary(p, f.ring) || !pointInPolygon(p, f.ring)) continue;
    if (!best || f.centreArea < best.centreArea) best = f;
  }
  return best;
}

function analyse(doc: Document): Analysis {
  const cached = memo.get(doc);
  if (cached) return cached;
  const faces = boundedFaces(doc);
  const labelsByFace = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const id of sortedIds(doc.zoneLabels)) {
    const label = doc.zoneLabels[id];
    const face = label ? containingFace(faces, label.at) : null;
    if (face) labelsByFace.set(face.key, [...(labelsByFace.get(face.key) ?? []), id]);
    else orphans.push(id);
  }
  const zones = faces.map((f): Zone => {
    const labelIds = labelsByFace.get(f.key) ?? [];
    if (!f.simple) return { face: publicFace(f), floor: null, area: null, unavailable: UNSUPPORTED_BOUNDARY, labelIds };
    const inset = insetFloor(f.ring);
    return inset
      ? { face: publicFace(f), floor: inset.floor, area: inset.area, unavailable: null, labelIds }
      : { face: publicFace(f), floor: null, area: null, unavailable: AREA_UNAVAILABLE, labelIds };
  });
  const result = { faces, zones, orphans };
  memo.set(doc, result);
  return result;
}

/** Rooms derived from the walls, with clear floor areas and resolved labels (spec §3.6). */
export function zones(doc: Document): readonly Zone[] {
  return analyse(doc).zones;
}

/** Labels outside every supported face ("no enclosing walls"). */
export function orphanLabelIds(doc: Document): readonly string[] {
  return analyse(doc).orphans;
}

/** The supported face containing p; null outside every face or within EPS of a boundary. */
export function faceAt(doc: Document, p: Point): Face | null {
  const f = containingFace(analyse(doc).faces, p);
  return f ? publicFace(f) : null;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/zones.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: zones with clear areas, label resolution and faceAt"
```

### Task 2.14: `labelZone` and `renameZone`

**Files:** Create `packages/domain/src/commands/labels.ts`, `packages/domain/test/labels.test.ts`.

(revised 2026-09-28 before wave 3: `renameZone` checks the ID with `isValidId` before the lookup, and one test covers `Object.prototype` names. The unguarded lookup found `Object.prototype.constructor` and wrote a bogus label.)

(revised 2026-09-28 after the wave 3 code review: renaming to the current name returns the input document itself. The implementation below is the final code; review tests live in the test file, not in this plan.)

`labelZone` requires `faceAt` to find a room, and it refuses a room that already has a label. The editor selects an existing zone instead of labelling it again (spec §3.6, §5.6). Dependencies are the label plus the face's walls and joints (§4.1 "Create label"). `renameZone` depends on the label only.

- [x] **Step 1: Write the failing test** `packages/domain/test/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { labelZone, renameZone } from "../src/commands/labels";
import { rectDoc } from "./helpers";

describe("labelZone", () => {
  it("labels an unlabelled room; deps are the label and the room's walls and joints", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = labelZone(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
    expect(r.value.patch.puts).toEqual([{ table: "zoneLabels", entity: { id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" } }]);
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "walls", id: "W1" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" }, { table: "walls", id: "W4" },
      { table: "zoneLabels", id: "L1" },
    ]);
  });

  it("refuses points outside rooms or on a boundary", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(labelZone(doc, { type: "labelZone", id: "L1", at: { x: 9, y: 2 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notInRoom", message: "Click inside a room" } });
    expect(labelZone(doc, { type: "labelZone", id: "L1", at: { x: 0.0005, y: 2 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notInRoom" } });
  });

  it("refuses a second label in a labelled room, a used ID and a long name", () => {
    const first = labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "A" });
    if (!first.ok) throw new Error(first.error.message);
    expect(labelZone(first.value.doc, { type: "labelZone", id: "L2", at: { x: 5, y: 3 }, name: "B" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "This room already has a label" } });
    expect(labelZone(first.value.doc, { type: "labelZone", id: "L1", at: { x: 5, y: 3 }, name: "B" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "x".repeat(201) }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });
});

describe("renameZone", () => {
  it("renames with the label as its only dependency", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "A" } } };
    const r = renameZone(doc, { type: "renameZone", id: "L1", name: "Kitchen" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1?.name).toBe("Kitchen");
    expect(r.value.patch.dependencies).toEqual([{ table: "zoneLabels", id: "L1" }]);
    expect(renameZone(doc, { type: "renameZone", id: "nope", name: "x" })).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("refuses IDs that name Object.prototype members", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "A" } } };
    expect(renameZone(doc, { type: "renameZone", id: "constructor", name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(renameZone(doc, { type: "renameZone", id: "toString", name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "constructor", at: { x: 1, y: 1 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/labels.test.ts`
Expected: FAIL, because `../src/commands/labels` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/labels.ts`:

```ts
import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { faceAt, zones } from "../queries/zones";
import { isFiniteNumber, isValidId, isValidName } from "../shape";
import type { CommandOf, CommandResult } from "./types";

/** Adds a zone label inside an unlabelled room (spec §3.6). */
export function labelZone(doc: Document, cmd: CommandOf<"labelZone">): CommandResult {
  if (!isValidId(cmd.id)) return err(domainError("invalidInput", "Invalid label ID"));
  if (doc.zoneLabels[cmd.id]) return err(domainError("invalidInput", "Label already exists"));
  if (!isFiniteNumber(cmd.at.x) || !isFiniteNumber(cmd.at.y)) return err(domainError("invalidInput", "Invalid position"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const face = faceAt(doc, cmd.at);
  if (!face) return err(domainError("notInRoom", MESSAGES.notInRoom));
  if (zones(doc).some((z) => z.face.key === face.key && z.labelIds.length > 0)) {
    return err(domainError("invalidInput", "This room already has a label"));
  }
  const next: Document = {
    ...doc,
    zoneLabels: { ...doc.zoneLabels, [cmd.id]: { id: cmd.id, at: { x: cmd.at.x, y: cmd.at.y }, name: cmd.name } },
  };
  const deps: EntityKey[] = [
    { table: "zoneLabels", id: cmd.id },
    ...face.wallIds.map((id): EntityKey => ({ table: "walls", id })),
    ...face.jointIds.map((id): EntityKey => ({ table: "joints", id })),
  ];
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

export function renameZone(doc: Document, cmd: CommandOf<"renameZone">): CommandResult {
  const label = isValidId(cmd.id) ? doc.zoneLabels[cmd.id] : undefined;
  if (!label) return err(domainError("notFound", "Zone not found"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const deps: EntityKey[] = [{ table: "zoneLabels", id: cmd.id }];
  if (cmd.name === label.name) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, [cmd.id]: { ...label, name: cmd.name } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/labels.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: labelZone inside unlabelled rooms and renameZone"
```

### Task 2.15: `deleteEntities` and the two-room label merge

**Files:** Create `packages/domain/src/commands/delete-entities.ts`, `packages/domain/test/delete-entities.test.ts`.

(revised 2026-09-28 after the wave 2 code review: `faceBefore` is a `Map<string, Face>`, because `Face` arrays are readonly and the planned inline type no longer accepted `z.face` (TS2345).)

(revised 2026-09-28 after the wave 3 reviews: the merge also depends on the merged face's boundary, an empty name adds nothing to a merged name, `cutName` keeps surrogate pairs whole, cleanup removes only endpoints of deleted walls, and `mergeLabels` returns `after` itself when nothing merged. The implementation below is the final code; review tests live in the test file, not in this plan.)

(revised 2026-09-28 before wave 3: every lookup in the `cmd.ids` loop checks the ID with `isValidId` first, and one test covers `Object.prototype` names. Unguarded, `walls/constructor` returned `ok` with a dependency `{ table: "joints", id: undefined }`.)

The merge rule (spec §3.6, narrowed to two rooms) applies when an after-deletion simple face holds **exactly two** surviving labels that sat in **two different** faces before the deletion. Their names are then joined with ` / ` in label-ID order; the first label keeps its ID and position and the second is deleted. Four cases leave labels as they are:
- one surviving label;
- three or more labels (deferred, §11);
- labels deleted explicitly;
- rooms opened to the exterior, whose labels become orphans.

A combined name longer than `MAX_NAME_LENGTH` is cut to 200 UTF-16 code units without splitting a surrogate pair (revised after the wave 3 spec review: `.slice` alone left half an emoji). The label changes are part of the same patch, so undo restores both labels and the divider together.

- [x] **Step 1: Write the failing test** `packages/domain/test/delete-entities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deleteEntities } from "../src/commands/delete-entities";
import type { EntityRef } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { docOf, rectDoc } from "./helpers";

const divided = (labels: [string, number, number, string][]) =>
  docOf({
    joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    labels,
  });
const del = (doc: ReturnType<typeof divided>, ids: EntityRef[]) => {
  const r = deleteEntities(doc, { type: "deleteEntities", ids });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const wall = (id: string): EntityRef => ({ table: "walls", id });

describe("deleteEntities", () => {
  it("deleting a joint deletes its walls and then unused joints", () => {
    const { doc } = del(rectDoc(0, 0, 6, 4), [{ table: "joints", id: "J3" }]);
    expect(Object.keys(doc.walls).sort()).toEqual(["W1", "W4"]);
    expect(Object.keys(doc.joints).sort()).toEqual(["J1", "J2", "J4"]);
  });

  it("deleting a wall removes joints left without walls", () => {
    const lone = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] });
    expect(del(lone, [wall("W")]).doc).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
  });

  it("deleting a label keeps the walls", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [{ table: "zoneLabels", id: "L1" }]);
    expect(doc.zoneLabels).toEqual({});
    expect(Object.keys(doc.walls)).toHaveLength(7);
  });

  it("merges two labelled rooms: names in label-ID order, first label kept", () => {
    const { doc, patch } = del(divided([["L2", 4.5, 2, "Dining"], ["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } });
    expect(patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
    expect(patch.dependencies).toContainEqual({ table: "zoneLabels", id: "L2" });
    expect(patch.dependencies).toContainEqual({ table: "walls", id: "R" });
  });

  it("keeps existing slashes verbatim", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "A/B"], ["L2", 4.5, 2, "C"]]), [wall("D")]);
    expect(doc.zoneLabels.L1?.name).toBe("A/B / C");
  });

  it("leaves a single surviving label unchanged (unlabelled room adds no name)", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } });
  });

  it("excludes explicitly deleted labels from the merge", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]), [wall("D"), { table: "zoneLabels", id: "L2" }]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } });
  });

  it("keeps labels as orphans when the deletion opens the rooms to the exterior", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]), [wall("D"), wall("R")]);
    expect(Object.keys(doc.zoneLabels).sort()).toEqual(["L1", "L2"]);
  });

  it("undo (the inverse patch) restores the divider and both labels at once", () => {
    const before = divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]);
    const { doc, patch } = del(before, [wall("D")]);
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: before });
  });

  it("reports missing entities", () => {
    const r = deleteEntities(rectDoc(0, 0, 6, 4), { type: "deleteEntities", ids: [wall("nope")] });
    expect(r).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("refuses IDs that name Object.prototype members", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const json = JSON.stringify(doc);
    const refs: EntityRef[] = [wall("constructor"), { table: "joints", id: "toString" }, { table: "zoneLabels", id: "constructor" }];
    for (const ref of refs) {
      expect(deleteEntities(doc, { type: "deleteEntities", ids: [ref] })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    }
    expect(JSON.stringify(doc)).toBe(json);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/delete-entities.test.ts`
Expected: FAIL, because `../src/commands/delete-entities` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/delete-entities.ts`:

```ts
import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { incidentWalls } from "../graph";
import { MAX_NAME_LENGTH, type Document, type Joint, type Wall, type ZoneLabel } from "../model";
import { diffPatch } from "../patch";
import type { Face } from "../queries/faces";
import { zones } from "../queries/zones";
import { isValidId } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

/**
 * Deletes the selected entities (spec §3.4, §3.6): a joint takes its incident walls with it, deleted
 * walls' endpoints that no surviving wall uses are removed, and when the deletion leaves exactly two
 * labels from different rooms in one supported room they combine ("Kitchen / Dining", label-ID
 * order, first label kept).
 */
export function deleteEntities(doc: Document, cmd: CommandOf<"deleteEntities">): CommandResult {
  if (cmd.ids.length === 0) return err(domainError("invalidInput", "Nothing selected"));
  const deps: EntityKey[] = [...cmd.ids];
  const walls: Record<string, Wall> = { ...doc.walls };
  const joints: Record<string, Joint> = { ...doc.joints };
  const labels: Record<string, ZoneLabel> = { ...doc.zoneLabels };
  const wallsToDelete = new Set<string>();

  for (const ref of cmd.ids) {
    switch (ref.table) {
      case "joints":
        if (!isValidId(ref.id) || !doc.joints[ref.id]) return err(domainError("notFound", "Joint not found"));
        for (const w of incidentWalls(doc, ref.id)) wallsToDelete.add(w);
        break;
      case "walls":
        if (!isValidId(ref.id) || !doc.walls[ref.id]) return err(domainError("notFound", "Wall not found"));
        wallsToDelete.add(ref.id);
        break;
      case "zoneLabels":
        if (!isValidId(ref.id) || !doc.zoneLabels[ref.id]) return err(domainError("notFound", "Zone not found"));
        delete labels[ref.id];
        break;
      default:
        return assertNever(ref.table);
    }
  }

  // In a valid document a selected joint is an endpoint of its deleted walls, so this removes it too.
  const endpoints = new Set<string>();
  for (const id of wallsToDelete) {
    const w = doc.walls[id];
    if (!w) continue;
    delete walls[id];
    endpoints.add(w.a).add(w.b);
    deps.push({ table: "walls", id }, { table: "joints", id: w.a }, { table: "joints", id: w.b });
  }
  const stillUsed = new Set(Object.values(walls).flatMap((w) => [w.a, w.b]));
  for (const id of endpoints) if (!stillUsed.has(id)) delete joints[id];

  let next: Document = { joints, walls, zoneLabels: labels };
  if (wallsToDelete.size > 0) next = mergeLabels(doc, next, deps);

  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", MESSAGES.invalid, valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Combines exactly two labels that now share a supported room but resolved to different rooms before;
 * three or more labels in one room stay as they are (spec §3.6, §11). Adds the merge's dependencies to
 * `deps`: both labels and the boundaries of both source rooms and of the merged room.
 */
function mergeLabels(before: Document, after: Document, deps: EntityKey[]): Document {
  const faceBefore = new Map<string, Face>();
  for (const z of zones(before)) for (const id of z.labelIds) faceBefore.set(id, z.face);
  let labels = after.zoneLabels;
  for (const z of zones(after)) {
    const [firstId, secondId, ...rest] = z.labelIds; // sorted by ID
    if (firstId === undefined || secondId === undefined || rest.length > 0) continue;
    const f1 = faceBefore.get(firstId);
    const f2 = faceBefore.get(secondId);
    const first = labels[firstId];
    const second = labels[secondId];
    if (!f1 || !f2 || f1.key === f2.key || !first || !second) continue;
    const name = cutName([first.name, second.name].filter((n) => n !== "").join(" / "));
    const kept = { ...labels, [firstId]: { ...first, name } };
    delete kept[secondId];
    labels = kept;
    for (const f of [f1, f2, z.face]) {
      deps.push(...f.wallIds.map((id): EntityKey => ({ table: "walls", id })));
      deps.push(...f.jointIds.map((id): EntityKey => ({ table: "joints", id })));
    }
    deps.push({ table: "zoneLabels", id: firstId }, { table: "zoneLabels", id: secondId });
  }
  return labels === after.zoneLabels ? after : { ...after, zoneLabels: labels };
}

/** Cuts a name to MAX_NAME_LENGTH UTF-16 units, dropping a high surrogate whose pair was cut off. */
function cutName(name: string): string {
  const cut = name.slice(0, MAX_NAME_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < name.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/delete-entities.test.ts`
Expected: PASS (11 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: deleteEntities with cascade, cleanup and two-room label merge"
```

### Task 2.16: Helper dimension and hit candidates

**Files:** Create `packages/domain/src/queries/helpers.ts`, `packages/domain/src/queries/hit.ts`, `packages/domain/test/hit-and-helpers.test.ts`.

`hitCandidates` returns joints first, then walls, each group ordered by distance and then ID. Labels are not included: their tag size depends on text metrics, which only the editor has (through `Host`).

- [x] **Step 1: Write the failing test** `packages/domain/test/hit-and-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wallHelperDimension } from "../src/queries/helpers";
import { hitCandidates } from "../src/queries/hit";
import { rectDoc } from "./helpers";

describe("wallHelperDimension", () => {
  it("measures the centreline from a to b", () => {
    expect(wallHelperDimension(rectDoc(0, 0, 6, 4), "W2")).toEqual({ a: { x: 6, y: 0 }, b: { x: 6, y: 4 }, length: 4 });
    expect(wallHelperDimension(rectDoc(0, 0, 6, 4), "nope")).toBeNull();
  });
});

describe("hitCandidates", () => {
  it("returns joints before walls, nearest first", () => {
    const doc = rectDoc(0, 0, 6, 4);
    // (6.02, 0.01) is 0.020 m from W2 (x = 6) and 0.022 m from W1's end (6, 0).
    expect(hitCandidates(doc, { x: 6.02, y: 0.01 }, 0.05)).toEqual([
      { table: "joints", id: "J2" }, { table: "walls", id: "W2" }, { table: "walls", id: "W1" },
    ]);
  });

  it("hits a wall body within half its thickness plus tolerance", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(hitCandidates(doc, { x: 3, y: 0.12 }, 0.05)).toEqual([{ table: "walls", id: "W1" }]);
    expect(hitCandidates(doc, { x: 3, y: 2 }, 0.05)).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/hit-and-helpers.test.ts`
Expected: FAIL, because `../src/queries/helpers` and `../src/queries/hit` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/queries/helpers.ts`:

```ts
import { distance } from "../geometry";
import { wallEnds } from "../graph";
import type { Document } from "../model";
import type { Point } from "@fm/protocol";

/** Endpoints and centreline length of a wall, for its editable helper dimension (spec §5.6). */
export function wallHelperDimension(doc: Document, wallId: string): { a: Point; b: Point; length: number } | null {
  const ends = wallEnds(doc, wallId);
  return ends ? { a: ends.a, b: ends.b, length: distance(ends.a, ends.b) } : null;
}
```

and `packages/domain/src/queries/hit.ts`:

```ts
import type { Point } from "@fm/protocol";
import { distance, distanceToSegment } from "../geometry";
import { sortedIds, wallEnds } from "../graph";
import { WALL_THICKNESS, type Document, type EntityRef } from "../model";

/**
 * Entities under a point: joints within `tolerance`, then walls whose body (centreline ± half the
 * thickness, plus tolerance) contains it; each group by distance, then ID. Labels are hit-tested by
 * the editor because their size depends on text metrics.
 */
export function hitCandidates(doc: Document, p: Point, tolerance: number): EntityRef[] {
  const joints: { id: string; d: number }[] = [];
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    const d = j ? distance(p, j) : Infinity;
    if (d <= tolerance) joints.push({ id, d });
  }
  const walls: { id: string; d: number }[] = [];
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    const d = ends ? distanceToSegment(p, ends.a, ends.b) : Infinity;
    if (d <= tolerance + WALL_THICKNESS / 2) walls.push({ id, d });
  }
  const order = (x: { id: string; d: number }, y: { id: string; d: number }): number =>
    x.d - y.d || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return [
    ...joints.sort(order).map((j): EntityRef => ({ table: "joints", id: j.id })),
    ...walls.sort(order).map((w): EntityRef => ({ table: "walls", id: w.id })),
  ];
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/hit-and-helpers.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: wall helper dimension and hit candidates"
```

### Task 2.17: Serialization and migrations

(revised 2026-09-28: the code blocks below are the final code: the wave 1 review added the `Object.prototype` ID test; the wave 4 code review made `MIGRATIONS` read-only, with a type test.)

**Files:** Create `packages/domain/src/serialize.ts`, `packages/domain/test/serialize.test.ts`.

This follows spec §3.7: write the minimum version the content needs, and upgrade old files with version-gated JSON visitors before parsing. Newer versions are rejected with a readable message; unknown fields are dropped; the loaded document is validated. Version 1 is the first format, so `MIGRATIONS` is empty; `migrateJson` is tested with fake migrations.

- [x] **Step 1: Write the failing test** `packages/domain/test/serialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, MIGRATIONS, deserialize, migrateJson, serialize } from "../src/serialize";
import { docOf, rectDoc } from "./helpers";

describe("serialize / deserialize", () => {
  it("round-trips a document with the minimum version", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall" } } };
    const json = serialize(doc);
    expect(json.format).toBe("flatmate");
    expect(json.version).toBe(1);
    expect(deserialize(JSON.parse(JSON.stringify(json)))).toEqual({ ok: true, value: doc });
  });

  it("rejects other formats, unknown and newer versions with readable errors", () => {
    expect(deserialize({ format: "dwg" })).toMatchObject({ ok: false, error: { kind: "format", message: "Not a Flatmate drawing" } });
    expect(deserialize({ format: "flatmate", version: 0 })).toMatchObject({ ok: false, error: { message: "Unknown file version" } });
    const newer = deserialize({ format: "flatmate", version: CURRENT_VERSION + 1, joints: {}, walls: {}, zoneLabels: {} });
    expect(newer).toMatchObject({ ok: false, error: { kind: "format" } });
    expect(newer.ok ? "" : newer.error.message).toContain("newer");
  });

  it("rejects malformed and invalid content", () => {
    expect(deserialize({ format: "flatmate", version: 1, joints: [], walls: {}, zoneLabels: {} })).toMatchObject({ ok: false });
    const invalid = serialize(docOf({ joints: [["A", 0, 0], ["B", 0.001, 0]], walls: [["W", "A", "B"]] }));
    expect(deserialize(invalid)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("rejects IDs that name Object.prototype members", () => {
    const inherited = { format: "flatmate", version: 1, joints: { J1: { id: "J1", x: 0, y: 0 } }, walls: { W: { id: "W", a: "constructor", b: "J1" } }, zoneLabels: {} };
    expect(deserialize(inherited)).toMatchObject({ ok: false, error: { kind: "format" } });
    // JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead.
    const proto: unknown = JSON.parse(
      '{"format":"flatmate","version":1,"joints":{"A":{"id":"A","x":0,"y":0},"B":{"id":"B","x":1,"y":0},' +
        '"__proto__":{"id":"__proto__","x":5,"y":5}},"walls":{"W":{"id":"W","a":"A","b":"B"}},"zoneLabels":{}}',
    );
    expect(deserialize(proto)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("drops unknown fields", () => {
    const json = { format: "flatmate", version: 1, extra: 1, joints: { A: { id: "A", x: 0, y: 0, z: 9 }, B: { id: "B", x: 1, y: 0 } }, walls: { W: { id: "W", a: "A", b: "B" } }, zoneLabels: {} };
    expect(deserialize(json)).toEqual({ ok: true, value: docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] }) });
  });

  it("applies version-gated JSON migrations in order", () => {
    const migrations = [
      { from: 1, migrate: (j: Record<string, unknown>) => ({ ...j, step1: true }) },
      { from: 2, migrate: (j: Record<string, unknown>) => ({ ...j, step2: true }) },
    ];
    expect(migrateJson({ v: 1 }, 1, 3, migrations)).toEqual({ ok: true, value: { v: 1, step1: true, step2: true } });
    expect(migrateJson({}, 1, 3, [])).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("the shipped migration list is read-only (type test; checked by pnpm typecheck)", () => {
    const mutate = (): void => {
      // @ts-expect-error MIGRATIONS is read-only
      MIGRATIONS.push({ from: 1, migrate: (j: Record<string, unknown>) => j });
    };
    expect(mutate).toBeTypeOf("function");
    expect(migrateJson({ v: 1 }, 1, 1, MIGRATIONS)).toEqual({ ok: true, value: { v: 1 } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/serialize.test.ts`
Expected: FAIL, because `../src/serialize` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/serialize.ts`:

```ts
import { err, isRecord, ok } from "@fm/protocol";
import type { Result } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { sortedIds } from "./graph";
import type { Document } from "./model";
import { parseTables } from "./shape";
import { validateDocument } from "./validate";

export type DocumentJson = { format: "flatmate"; version: number; joints: unknown; walls: unknown; zoneLabels: unknown };
export const CURRENT_VERSION = 1;

/**
 * Upgrades a file from `from` to `from + 1` by rewriting its JSON (spec §3.7). `migrate` must not
 * throw; return the input unchanged when expected fields are missing.
 */
export type Migration = { from: number; migrate(json: Record<string, unknown>): Record<string, unknown> };

/** Version 1 is the first format, so there is nothing to migrate yet. */
export const MIGRATIONS: readonly Migration[] = [];

/** The lowest file version that can hold a document's content; every document fits version 1. */
function requiredVersion(): number {
  return 1;
}

function sortedTable<T>(table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of sortedIds(table)) {
    const v = table[id];
    if (v !== undefined) out[id] = v;
  }
  return out;
}

export function serialize(doc: Document): DocumentJson {
  return {
    format: "flatmate",
    version: requiredVersion(),
    joints: sortedTable(doc.joints),
    walls: sortedTable(doc.walls),
    zoneLabels: sortedTable(doc.zoneLabels),
  };
}

/** Applies migrations in order until the JSON reaches `target`. */
export function migrateJson(
  json: Record<string, unknown>,
  version: number,
  target: number,
  migrations: readonly Migration[],
): Result<Record<string, unknown>, DomainError> {
  let current = json;
  for (let v = version; v < target; v++) {
    const m = migrations.find((x) => x.from === v);
    if (!m) return err(domainError("format", `No migration from file version ${v}`));
    current = m.migrate(current);
  }
  return ok(current);
}

export function deserialize(json: unknown): Result<Document, DomainError> {
  if (!isRecord(json) || json.format !== "flatmate") return err(domainError("format", "Not a Flatmate drawing"));
  const version = json.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return err(domainError("format", "Unknown file version"));
  }
  if (version > CURRENT_VERSION) {
    return err(domainError("format", `This drawing needs a newer Flatmate (file version ${version}, supported ${CURRENT_VERSION})`));
  }
  const migrated = migrateJson(json, version, CURRENT_VERSION, MIGRATIONS);
  if (!migrated.ok) return migrated;
  const doc = parseTables(migrated.value);
  if (!doc.ok) return doc;
  const valid = validateDocument(doc.value);
  if (!valid.ok) {
    return err(domainError("format", `Drawing is invalid: ${valid.error[0]?.message ?? "unknown problem"}`, valid.error));
  }
  return ok(doc.value);
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/serialize.test.ts`
Expected: PASS (7 tests; revised: +1 wave 1 review, +1 wave 4 code review).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: versioned serialization with JSON-visitor migrations"
```

### Task 2.18: `execute`, the script helper and the public index

**Files:** Create `packages/domain/src/commands/execute.ts`, `packages/domain/src/scripts.ts`, `packages/domain/test/execute.test.ts`; replace `packages/domain/src/index.ts`.

(revised 2026-09-28 after the wave 1 review: `execute` first checks every entity ID the command names with `isValidId`, which rejects names of `Object.prototype` members. Documents are plain objects, so `doc.walls["constructor"]` would otherwise find an inherited member. One guard here protects every command's lookups.)

(revised 2026-09-28 after the wave 4 review: the code blocks below are the final code. Tests added for the ID guard on every command, no-op commands through `execute` (empty patch and the input document), `rectangleRoom`'s IDs and reuse, and deep-frozen inputs; comments narrowed. After the wave 4 code review: `execute` returns the input document for every no-op (one rule for all commands), round trips must write something, `AREA_UNAVAILABLE` is no longer public, and the script test goes through the public entry.)

A command that changes nothing returns `ok` with an **empty** patch (no puts, no deletes). For example, renaming a zone to its current name. Callers skip committing it; the editor must check this (listed under Contract extensions). The round-trip test checks that every command's patch inverts exactly.

- [x] **Step 1: Write the failing test** `packages/domain/test/execute.test.ts`:

```ts
import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import * as domain from "../src";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { zones } from "../src/queries/zones";
import { rectangleRoom } from "../src/scripts";
import { deepFreeze, rectDoc } from "./helpers";

describe("execute", () => {
  it("builds a 4 × 5 m room from a script (spec §3.1): 3.8 × 4.8 = 18.24 m²", () => {
    // Through the public entry, as the spec's example uses it.
    let doc = domain.emptyDocument();
    for (const cmd of domain.rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = domain.unwrap(domain.execute(doc, cmd)).doc;
    expect(Object.keys(doc.walls)).toHaveLength(4);
    expect(domain.zones(doc).map((z) => z.area?.toFixed(2))).toEqual(["18.24"]);
  });

  it("rectangleRoom's IDs are deterministic (spec §3.4); a used prefix is refused, a new one builds a second room", () => {
    const script = rectangleRoom({ x: 0, y: 0 }, 4, 5);
    let doc = emptyDocument();
    for (const cmd of script) doc = unwrap(execute(doc, cmd)).doc;
    expect(Object.keys(doc.joints).sort()).toEqual(["room-1/j0", "room-1/j1", "room-2/j0", "room-3/j0"]);
    expect(Object.keys(doc.walls).sort()).toEqual(["room-1/w0", "room-2/w0", "room-3/w0", "room-4/w0"]);
    const used = { kind: "invalidInput", message: "Operation ID already used", violations: [] };
    for (const cmd of script) expect(execute(doc, cmd)).toEqual({ ok: false, error: used });
    for (const cmd of rectangleRoom({ x: 10, y: 0 }, 4, 5, "b")) doc = unwrap(execute(doc, cmd)).doc;
    expect(zones(doc).map((z) => z.area?.toFixed(2))).toEqual(["18.24", "18.24"]);
  });

  // Every command's patch must undo exactly: apply(doc', invert(patch)) === doc. The input is frozen,
  // so a command that writes to it throws.
  const base = (): Document => {
    let doc = rectDoc(0, 0, 6, 4);
    doc = unwrap(execute(doc, { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } })).doc;
    doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" })).doc;
    return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining" })).doc;
  };
  const unlabelled = (): Document => rectDoc(0, 0, 6, 4);
  const cases: [string, () => Document, Command][] = [
    ["addWall", base, { type: "addWall", opId: "x", from: { at: { x: 1, y: 0 } }, to: { at: { x: 1, y: 1 } } }],
    ["moveJoints", base, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6.5, y: 4.5 } }] }],
    ["setWallLength", base, { type: "setWallLength", wallId: "W2", length: 3.5, keep: "a" }],
    ["labelZone", unlabelled, { type: "labelZone", id: "L3", at: { x: 1, y: 1 }, name: "x" }],
    ["renameZone", base, { type: "renameZone", id: "L1", name: "Cook" }],
    ["deleteEntities", base, { type: "deleteEntities", ids: [{ table: "walls", id: "d/w0" }] }],
  ];
  for (const [name, build, cmd] of cases) {
    it(`${name}: the inverse patch restores the document`, () => {
      const doc = deepFreeze(build());
      const r = unwrap(execute(doc, cmd));
      expect(r.patch.puts.length + r.patch.deletes.length).toBeGreaterThan(0);
      expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
      expect(unwrap(applyPatch(doc, r.patch))).toEqual(r.doc);
    });
  }

  it("a command that changes nothing returns an empty patch and the input document", () => {
    const doc = base();
    const noOps: Command[] = [
      { type: "renameZone", id: "L1", name: "Kitchen" },
      { type: "setWallLength", wallId: "W2", length: 4, keep: "a" },
      { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 4 } }] },
    ];
    for (const cmd of noOps) {
      const r = unwrap(execute(doc, cmd));
      expect(r.patch.puts, cmd.type).toEqual([]);
      expect(r.patch.deletes, cmd.type).toEqual([]);
      expect(r.patch.before, cmd.type).toEqual([]);
      expect(r.doc, cmd.type).toBe(doc);
    }
  });

  it("refuses IDs that are not valid IDs, including Object.prototype names", () => {
    const doc = base();
    const bad: Command[] = [
      { type: "setWallLength", wallId: "constructor", length: 3, keep: "a" },
      { type: "renameZone", id: "toString", name: "x" },
      { type: "moveJoints", moves: [{ jointId: "__proto__", to: { x: 1, y: 1 } }] },
      { type: "deleteEntities", ids: [{ table: "walls", id: "has space" }] },
      { type: "addWall", opId: "y", from: { existing: "valueOf" }, to: { at: { x: 1, y: 1 } } },
      { type: "addWall", opId: "z", from: { at: { x: 1, y: 1 } }, to: { existing: "isPrototypeOf" } },
      // labelZone would answer "Invalid label ID" itself; the guard answers first.
      { type: "labelZone", id: "hasOwnProperty", at: { x: 100, y: 100 }, name: "x" },
      { type: "deleteEntities", ids: [{ table: "joints", id: "__proto__" }] },
      { type: "deleteEntities", ids: [{ table: "zoneLabels", id: "toLocaleString" }] },
      { type: "moveJoints", moves: [{ jointId: "J1", to: { x: 0, y: 0 } }, { jointId: "propertyIsEnumerable", to: { x: 1, y: 1 } }] },
    ];
    for (const cmd of bad) expect(execute(doc, cmd)).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid ID" } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/domain test test/execute.test.ts`
Expected: FAIL, because `../src/commands/execute` and `../src/scripts` cannot be resolved.

- [x] **Step 3: Implement** `packages/domain/src/commands/execute.ts`:

```ts
import { assertNever, err, ok } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document } from "../model";
import { isValidId } from "../shape";
import { addWall } from "./add-wall";
import { deleteEntities } from "./delete-entities";
import { labelZone, renameZone } from "./labels";
import { moveJoints } from "./move-joints";
import { setWallLength } from "./set-wall-length";
import type { Command, CommandResult } from "./types";

/**
 * Runs a command against a document without modifying it. For a valid input document (I1–I8) and a
 * command of the `Command` type, the result is a valid document or an error; malformed JSON commands
 * are not shape-checked here. A command that changes nothing returns an empty patch and the input
 * document itself; callers skip it.
 */
export function execute(doc: Document, cmd: Command): CommandResult {
  // One message ("Invalid ID") for malformed IDs from any command; each command also checks its own
  // lookups. Documents are plain objects: an ID such as "constructor" would find an inherited member.
  if (!commandIds(cmd).every(isValidId)) return err(domainError("invalidInput", "Invalid ID"));
  const result = run(doc, cmd);
  if (!result.ok) return result;
  const { patch } = result.value;
  return patch.puts.length === 0 && patch.deletes.length === 0 ? ok({ doc, patch }) : result;
}

function run(doc: Document, cmd: Command): CommandResult {
  switch (cmd.type) {
    case "addWall": return addWall(doc, cmd);
    case "moveJoints": return moveJoints(doc, cmd);
    case "setWallLength": return setWallLength(doc, cmd);
    case "labelZone": return labelZone(doc, cmd);
    case "renameZone": return renameZone(doc, cmd);
    case "deleteEntities": return deleteEntities(doc, cmd);
    default: return assertNever(cmd);
  }
}

/** Every entity ID the command names. addWall's opId is not one: addWall checks it with its own message. */
function commandIds(cmd: Command): string[] {
  switch (cmd.type) {
    case "addWall": return [cmd.from, cmd.to].flatMap((r) => ("existing" in r ? [r.existing] : []));
    case "moveJoints": return cmd.moves.map((m) => m.jointId);
    case "setWallLength": return [cmd.wallId];
    case "labelZone": return [cmd.id];
    case "renameZone": return [cmd.id];
    case "deleteEntities": return cmd.ids.map((r) => r.id);
    default: return assertNever(cmd);
  }
}
```

`packages/domain/src/scripts.ts`:

```ts
import type { Point } from "@fm/protocol";
import type { Command } from "./commands/types";

/**
 * Four addWall commands tracing a width × height rectangle from `origin`, counter-clockwise when
 * width and height are positive (addWall ignores direction). Their operation IDs are
 * `${opPrefix}-1` … `${opPrefix}-4`; the prefix must not already be used in the document, so a
 * second room needs another prefix.
 */
export function rectangleRoom(origin: Point, width: number, height: number, opPrefix = "room"): Command[] {
  const p0 = origin;
  const p1 = { x: origin.x + width, y: origin.y };
  const p2 = { x: origin.x + width, y: origin.y + height };
  const p3 = { x: origin.x, y: origin.y + height };
  const sides: [Point, Point][] = [[p0, p1], [p1, p2], [p2, p3], [p3, p0]];
  return sides.map(([from, to], i): Command => ({
    type: "addWall",
    opId: `${opPrefix}-${i + 1}`,
    from: { at: from },
    to: { at: to },
  }));
}
```

and replace `packages/domain/src/index.ts` completely:

```ts
// Re-exported so scripts need only @fm/domain.
export { ok, err, unwrap, assertNever } from "@fm/protocol";
export type { Point, Result } from "@fm/protocol";
export * from "./model";
export * from "./errors";
export * from "./geometry";
export * from "./shape";
export * from "./validate";
export * from "./patch";
export * from "./graph";
export * from "./commands/types";
export { execute } from "./commands/execute";
export { wallOutlines } from "./queries/outlines";
export type { Face } from "./queries/faces";
export { zones, orphanLabelIds, faceAt, type Zone } from "./queries/zones";
export { wallHelperDimension } from "./queries/helpers";
export { hitCandidates } from "./queries/hit";
export * from "./serialize";
export { rectangleRoom } from "./scripts";
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/domain test test/execute.test.ts`
Expected: PASS (10 tests; revised: +1 for the ID guard, +2 after the wave 4 spec review for no-op commands and the script's IDs, −1 after the wave 4 code review: the deep-frozen round trips replace the "never modifies its input" test).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: execute dispatcher, rectangleRoom script helper and public exports"
```

### Task 2.19: Demo geometry and performance check

**Files:** Create `packages/domain/test/demo-geometry.test.ts`, `packages/domain/test/performance.test.ts`.

These tests use code that already exists, so they should pass on the first run. If one fails, it is a real finding: stop, debug it, and log it.

(revised 2026-09-28: the code below is the final code. Before dispatch, `performance.test.ts` got local `performance`/`console` declarations; the wave 5 spec review tied labels to areas, pinned the split fragments, the kept end and the single I5 violation, froze step 6's input, and added warm medians including `execute(moveJoints)`. The wave 5 code review replaced rounded areas by tolerances (9.936 m² is 0.001 m² from the `toFixed(2)` boundary), pinned the divider joints, added the `{ existing }` chain test and tidied the timing helper. The same review strengthened a 2.7 test (above) and added a 0.10 m square to `zones.test.ts`.)

Demo IDs, for reference in later phases:

```
op "a": (0,0)→(6,0)   a/j0 (0,0), a/j1 (6,0), wall a/w0
op "b": (6,0)→(6,4)   reuses a/j1; b/j0 (6,4); wall b/w0 = right wall, a = (6,0)
op "c": (6,4)→(0,4)   c/j0 (0,4); wall c/w0 = top wall
op "d": (0,4)→(0,0)   reuses c/j0 and a/j0: closes the room
op "e": (3,0)→(3,4)   splits a/w0 (e/w1 = (3,0)→(6,0)) and c/w0 (e/w2 = (3,4)→(0,4)); divider e/w0
```

`a`–`e` are fixture `opId`s: the editor generates its own, so editor tests that need these IDs must send these exact commands, not rely on the ID strings. Endpoints given as `{ existing: "<joint>" }` (how the editor continues a chain and closes a room) give the same document as the `{ at }` points above (pinned by a test).

- [x] **Step 1: Write the demo test** `packages/domain/test/demo-geometry.test.ts`:

```ts
import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { zones } from "../src/queries/zones";
import { deepFreeze } from "./helpers";

// Spec §1.4 steps 2–6, driven only through the domain API (world y up, metres).
const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({
  type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } },
});
const run = (doc: Document, cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
// Label id → area of the room it resolves to, so the check does not depend on zone order.
const labelAreas = (doc: Document) => Object.fromEntries(zones(doc).flatMap((z) => z.labelIds.map((id) => [id, z.area])));

const step2 = () => run(emptyDocument(), [wall("a", [0, 0], [6, 0]), wall("b", [6, 0], [6, 4]), wall("c", [6, 4], [0, 4]), wall("d", [0, 4], [0, 0])]);
const step3 = () => run(step2(), [wall("e", [3, 0], [3, 4])]);
const step4 = () => run(step3(), [
  { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" },
  { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2" },
]);
const step5 = () => run(step4(), [{ type: "setWallLength", wallId: "b/w0", length: 3.5, keep: "a" }]);

describe("demo geometry (spec §1.4 steps 2–6)", () => {
  it("step 2: four walls close a 6 × 4 room: (6 − 0.2) × (4 − 0.2) = 22.04 m²", () => {
    const doc = step2();
    expect(Object.keys(doc.joints)).toHaveLength(4);
    expect(Object.keys(doc.walls)).toHaveLength(4);
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "c/j0", b: "a/j0" }); // closed on the first joint
    expect(zones(doc)).toHaveLength(1);
    expect(zones(doc)[0]?.area).toBeCloseTo(22.04, 6);
  });

  it("step 2 with existing-joint endpoints (as the editor sends a chain) gives the same document", () => {
    const doc = run(emptyDocument(), [
      wall("a", [0, 0], [6, 0]),
      { type: "addWall", opId: "b", from: { existing: "a/j1" }, to: { at: { x: 6, y: 4 } } },
      { type: "addWall", opId: "c", from: { existing: "b/j0" }, to: { at: { x: 0, y: 4 } } },
      { type: "addWall", opId: "d", from: { existing: "c/j0" }, to: { existing: "a/j0" } },
    ]);
    expect(doc).toEqual(step2());
  });

  it("step 3: the divider (3,0) → (3,4) splits the bottom and top walls into T-junctions", () => {
    const doc = step3();
    expect(doc.joints["e/j0"]).toEqual({ id: "e/j0", x: 3, y: 0 });
    expect(doc.joints["e/j1"]).toEqual({ id: "e/j1", x: 3, y: 4 });
    expect(doc.walls["e/w0"]).toEqual({ id: "e/w0", a: "e/j0", b: "e/j1" });
    expect(doc.walls["a/w0"]).toEqual({ id: "a/w0", a: "a/j0", b: "e/j0" });
    expect(doc.walls["e/w1"]).toEqual({ id: "e/w1", a: "e/j0", b: "a/j1" }); // bottom wall's right fragment
    expect(doc.walls["c/w0"]).toEqual({ id: "c/w0", a: "b/j0", b: "e/j1" });
    expect(doc.walls["e/w2"]).toEqual({ id: "e/w2", a: "e/j1", b: "c/j0" }); // top wall's left fragment
    expect(Object.keys(doc.walls)).toHaveLength(7);
    expect(Object.keys(doc.joints)).toHaveLength(6);
  });

  it("step 4: two labelled rooms of 10.64 m² each", () => {
    const doc = step4();
    expect(zones(doc)).toHaveLength(2);
    expect(labelAreas(doc)).toEqual({ L1: expect.closeTo(10.64, 6), L2: expect.closeTo(10.64, 6) });
  });

  it("step 5: resizing the right wall (a = (6,0)) to 3.5 moves (6,4) to (6,3.5) and slopes the top wall", () => {
    const doc = step5();
    expect(doc.walls["b/w0"]?.a).toBe("a/j1");
    expect(doc.joints["a/j1"]).toEqual({ id: "a/j1", x: 6, y: 0 }); // the kept end stays put
    expect(doc.joints["b/j0"]).toEqual({ id: "b/j0", x: 6, y: 3.5 });
    expect(doc.walls["c/w0"]).toEqual({ id: "c/w0", a: "b/j0", b: "e/j1" }); // (6,3.5) → (3,4)
    expect(zones(doc)).toHaveLength(2);
    // Only the right room shrinks: it spans x 3.1–5.9, the top wall's centre is 3.75 high on average and its inner
    // face is inset 0.1·√(1 + 1/36) m, so 2.8 × (3.75 − 0.1 − 0.1·√(1 + 1/36)) ≈ 9.936 m² (displayed 9.94).
    expect(labelAreas(doc)).toEqual({ L1: expect.closeTo(10.64, 6), L2: expect.closeTo(9.9361, 4) });
  });

  it("step 6: dragging that joint to (2,2) is refused: the right wall would cross the divider at (3, 1.5)", () => {
    const doc = deepFreeze(step5());
    const r = execute(doc, { type: "moveJoints", moves: [{ jointId: "b/j0", to: { x: 2, y: 2 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(r.ok ? [] : r.error.violations).toEqual([{
      invariant: "I5",
      message: "Walls b/w0 and e/w0 cross",
      entities: [{ table: "walls", id: "b/w0" }, { table: "walls", id: "e/w0" }],
    }]);
    expect(doc).toEqual(step5());
  });
});
```

- [x] **Step 2: Write the timing test** `packages/domain/test/performance.test.ts` (it only logs; the one assertion checks the result, not the time):

```ts
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import type { Document } from "../src/model";

// Timings print only with `--reporter=verbose` or `--silent=false`.
// Domain tests compile without DOM or Node types; Node provides these two globals at run time.
declare const performance: { now(): number };
declare const console: { log(message: string): void };

/** An n × n grid of 1 m rooms; grid(12) has 169 joints, 312 walls, 144 faces. */
function grid(n: number): Document {
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  const j = (x: number, y: number) => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y) };
      if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1) };
    }
  }
  return doc;
}

describe("performance (logs only; spec §3.3 says O(n²) is fine for a few hundred walls)", () => {
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

  // The editor validates on every drag preview (spec §5.7), so the warm cost is the one a drag pays.
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
```

- [x] **Step 3: Run both**

Run: `pnpm --filter @fm/domain test test/demo-geometry.test.ts test/performance.test.ts --reporter=verbose`
Expected: PASS (8 tests), plus a warm-median line and one line like `validateDocument: 13.8 ms, zones: 7.6 ms (312 walls)`. The planning run measured about 14 ms and 8 ms. Vitest may hide console output of passing tests without `--silent=false`. Copy the line into the sprint log.

- [x] **Step 4: Run the whole package**

Run: `pnpm --filter @fm/domain test`
Expected: PASS (20 test files, 182 tests; the planning run had 114 before the review fixes).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/domain
git commit -m "domain: demo steps 2-6 through execute, and a timing check for 312 walls"
```

## Completion criteria

- [x] `pnpm check` passes; `pnpm --filter @fm/domain test` runs 20 files and 186 tests, or more if tests were added.
- [x] Lint finds no `as`/`!` in `packages/domain/src`, and dependency-cruiser confirms that `@fm/domain` imports only `@fm/protocol`.
- [x] Each invariant I1–I8 is detected, including malformed IDs, NaN/Infinity and key/ID mismatch (spec §9 domain row).
- [x] Mitered corner, T-junction, flat end and sharp-angle bevel outlines have worked-number tests.
- [x] Endpoint-on-wall T-junction split keeps the wall ID on the `a` side. Interior crossing, passing through a joint and collinear overlap are rejected.
- [x] A divider 0.30 m from a corner succeeds. A split leaving a fragment under 1 cm fails atomically with "Intersection would create a wall shorter than 1 cm" (acceptance scenario).
- [x] Destination-only moves: jumping across a wall is valid; ending across one is a `topology` error and the input is unchanged.
- [x] Faces: a rectangle gives one room, a divider gives two, and dangling walls and separate components are handled.
- [x] Areas:
  - a fixed-thickness clear area of 10.64 m² per demo room;
  - a straight split wall keeps the same area;
  - a narrow room and a 0.10 m square give "Area unavailable", and the drawing stays valid (acceptance scenario).
- [x] Wall resize keeps connections, and its dependencies include the walls incident to the moving endpoint.
- [x] Label merge on divider deletion:
  - names joined with ` / ` in label-ID order, and slashes kept verbatim;
  - a single label, explicitly deleted labels and rooms opened to the exterior leave labels unchanged;
  - the inverse patch restores both labels and the divider at once (domain half of the acceptance scenario).
- [x] Reordering table insertion order gives identical documents and patches, and equal-distance joint ties go to the smaller ID (acceptance scenario).
- [x] Every command's patch inverts exactly (round trip).
- [x] `serialize`/`deserialize` round-trip, reject newer versions readably and drop unknown fields; migrations are exercised.
- [x] The script builds a 4 × 5 m room with an area of 18.24 m² (spec §2.3 scripts row, §3.1).
- [x] Demo steps 2–6 pass through `execute` alone: 22.04 m² → 10.64 + 10.64 → 10.64 + 9.94 after the resize → step 6 refused with "Walls can't cross" (I5 between `b/w0` and `e/w0`).
- [x] The 312-wall timing is recorded in the sprint log.

## Gate 2

Follow the README gate protocol. Phase-specific additions:

**Verification commands**

```bash
pnpm check
pnpm --filter @fm/domain test                                   # 20 files, 186 tests
pnpm --filter @fm/domain test test/performance.test.ts --reporter=verbose   # timing lines for the report
pnpm depcruise                                                  # domain → protocol only
```

**Demo steps to try:** 2–6 as domain-level tests (`test/demo-geometry.test.ts`). No UI exists yet.

**The report must answer:**
1. Which invariant or normalisation rule was ambiguous in practice? Start from the choices made while planning and say whether each held up:
   - ties within `1e-9` count as equal;
   - `labelZone` refuses a labelled room;
   - merged names are cut to 200 code units without splitting a character;
   - label names may be empty;
   - non-simple faces have no area and hold no labels;
   - unchanged commands return empty patches;
   - reused `opId`s are refused.
2. Numeric tolerance trouble: `EPS` (1 mm) against `MIN_EDGE` (1 cm), the parallel thresholds in `segmentIntersection` (`1e-9`) and `lineIntersection` (`1e-12`), and any flaky float comparison. Add each failing case as a test.
3. Performance: `validateDocument` and `zones` on 312 walls. Flag anything over about 50 ms: the editor validates on every drag preview (spec §5.7).
4. Do the `DomainError` messages read well as toasts? Current texts:
   - "Wall too short"
   - "Walls can't cross"
   - "Walls can't overlap"
   - "Joints can't overlap"
   - "Intersection would create a wall shorter than 1 cm"
   - "Click inside a room"
   - "This room already has a label"
   - "Invalid drawing"
   - "Nothing selected"
   - "Zone not found"
5. What phase 3 must know: empty patches, the `Zone.unavailable` strings, labels missing from `hitCandidates`, and the demo IDs above.

## Contract extensions

Additions to the README's `@fm/domain` contract. Nothing is renamed. Items marked *(internal)* are not exported from `index.ts`.

- `errors.ts`: `MESSAGES` (toast texts), `domainError(kind, message, violations?)`, `topologyMessage(violations)`.
- `shape.ts`: `isFiniteNumber`, `isValidName`, `parsePoint`, `parseTables(raw)` (shared by `fromStored` and `deserialize`).
- `graph.ts`: `jointWalls(doc)` (joint → incident wall IDs), `jointPoint`, `wallEnds`.
- `commands/types.ts`: `CommandOf<T>`, `CommandResult`.
- `commands/move-joints.ts`: `applyMoves` *(internal)*.
- `queries/faces.ts`: `BoundedFace`, `boundedFaces` *(internal)*.
- `queries/area.ts`: `insetFloor` *(internal)*, `AREA_UNAVAILABLE` *(internal; revised after the wave 4 code review: its sibling "unsupported boundary" is private too, and callers display `Zone.unavailable` as is)*.
- `serialize.ts`: `Migration`, `MIGRATIONS` (`readonly Migration[]`), `migrateJson` (takes `readonly Migration[]`).
- Behaviour the contract did not state:
  - a command that changes nothing returns `ok` with an empty patch, and callers skip the commit;
  - `Zone.unavailable` is `"Area unavailable: unsupported geometry"` (the inset failed) or `"Area unavailable: unsupported boundary"` (the walk repeats a joint);
  - a face `key` is valid within one document state only;
  - `DomainPatch.dependencies` is sorted and unique, and may overlap the writes.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-27 | 2.3 | issue / plan change | `pnpm check` failed lint: `no-useless-escape` on `\/` in `ID_PATTERN`. The planning scratch run linted without `@eslint/js` recommended. | Removed the escape (same regex). Revised phase 2 Task 2.3, phase 6 Task 6.1 and the README contract comment. | implementation.md: tooling note + deviation row |
| 2026-09-28 | 1.6 (during 2.4) | issue / plan change | User asked whether packages use each other's files freely. Probe: `@fm/domain/src/geometry` is blocked (TS2307, `no-unresolvable`), but `../../domain/src/geometry` from editor passed tsc, lint and depcruise. | Added depcruise rule `only-through-package-index`; the probe now fails; clean tree passes (19 modules, 39 dependencies). Checked planned relative imports in phases 3–8: all same-package. | architecture.md (decision + Don't), implementation.md (note + deviation), process.md lesson 21, INDEX.md |
| 2026-09-28 | 2.7, 2.10, 2.11, 2.12, 2.16, 2.17 | process | Wave 1 ran as six parallel Opus agents in git worktrees. Every task: red for the expected reason, green with the planned count, `pnpm check` clean, code identical to the plan, no lint fixes. Cherry-picked as `d2f939c`..`68c31d1`; merged tree: domain 12 files, 64 tests. | Worktrees removed; `.claude/worktrees/` added to `.gitignore` and ESLint ignores. | implementation.md (decision row, tooling note), process.md |
| 2026-09-28 | 2.10 | issue / spec change | Inner miters are not clamped: a U shape with a 0.05 m middle wall gives W2 the outline `[(0.1,0.1),(-0.1,-0.1),(0.15,-0.1),(-0.05,0.1)]` (`isSimplePolygon` false, signed area +0.01) in a valid document. Tests check winding only. | Accepted as a constraint (no code change); spec §3.5 states it. Risk for S1 (earcut needs simple polygons). | domain-geometry.md (decision + Don't), spec §3.5 |
| 2026-09-28 | 2.17 | note | Integer-like IDs ("12") are listed first by JS objects, so serialized tables are sorted only for other IDs. Fingerprints use `canonicalJson`, unaffected. | None; don't claim canonical file output. | implementation.md tooling note |
| 2026-09-28 | 2.11 | note | A separate room drawn inside another (not joined) does not reduce the outer room's area: its exterior walk is dropped. | None: nested rings are deferred (spec §3.6, §11). | already in domain-geometry.md Don't |
| 2026-09-28 | 2.7 | note | `moveJoints` accepts the same joint twice (last position wins) and may list a shared wall twice in dependencies (`diffPatch` dedupes). | None; the editor never sends duplicates. | none |
| 2026-09-28 | wave 1 review | issue / spec change | Spec reviewer: code identical to the plan, demo numbers right, but (1) IDs naming `Object.prototype` members passed I1/I8 (`deserialize` accepted a wall to `"constructor"`; a `"__proto__"` joint vanished on load; moving `"toString"` gave `topology`), (2) face half-edge keys could collide because `:` is a legal ID character, (3) spec behaviour without tests. | Fix agent: `isValidId` refuses prototype names, `moveJoints` → `notFound`, half-edge key uses `\|`, plus 6 tests (`dc7cdea`, `ec6eb07`; domain 73 tests). Task 2.18 revised: `execute` checks every command ID. Phase 6 `isWireId` and README contract revised. Spec I8 states the ID rule; §3.5 constraint now covers sharp angles. | domain-geometry.md (decision + Don't), process.md lesson 22, implementation.md deviations |
| 2026-09-28 | wave 1 review | note | The dumbbell test does not prove bridge removal (a bridge between rooms only changes the dropped exterior walk); the dangling-stub test is the real guard. | Test named for what it checks. | none |
| 2026-09-28 | wave 1 review | note | "Joints can't overlap" is unreachable for moves: I4 always comes with I6 or I2, which `topologyMessage` ranks first. | For gate question 4 (toast texts). | none yet |
| 2026-09-28 | wave 1 review | note | Patch delete IDs are not shape-checked in the domain (`entityValue("constructor")` finds an inherited member). The wire boundary is covered: phase 6 `parseEntityKey` checks every key with `isWireId`, which now has the same rule. | None in phase 2. | implementation.md deviation row (6.1) |
| 2026-09-28 | wave 1 code review | issue / plan change | Approve with minor fixes. Important: the zones cache (2.13) would share mutable `Face` arrays and the planned 2.13 test sorts them in place. Minor: `wallEnds`/`jointPoint` resolved `"constructor"` (fake point), hit ties only on bitwise-equal distances, outline doc omitted §3.5, brittle `-0` rounding, weak CCW test, demo 9.936 m² not pinned. Measured on 312 walls: `validateDocument` 4.2 ms, `boundedFaces` 1.3 ms, faces + inset 1.7 ms, `wallOutlines` 0.6 ms. | Fix agent `2a8c0ce`: readonly faces, ring helpers take `readonly Point[]`, ID guard in `jointPoint`/`wallEnds`, 1e-9 hit tie tolerance, doc comments, test fixes and edge cases (domain 80 tests). Plans revised: 2.13 (readonly `Zone`, results, test copies before sorting), README contract, phase 3 scene polygon `points: readonly Point[]`. Skipped as not worth it: `requiredVersion(doc)` seam, shared `JointMove` type, frozen reserved-ID list. | domain-geometry.md (decision + Don't), implementation.md deviation |
| 2026-09-28 | wave 1 code review | note | Ring points (`Point` objects) and `boundedFaces`' outer array stay mutable; a sort-comparator tie tolerance is not strictly transitive. | Accepted: readonly arrays stop the accidental in-place sort; nothing mutates points. | none |
| 2026-09-28 | 2.8, 2.9, 2.13 + clamp | process | Wave 2: four parallel Opus agents from `1d49abc`. 2.9 and 2.13 identical to the plan; 2.8 one guarded line (below); clamp new work. Cherry-picked `076ce1d`..`8790ded`; domain 15 files, 105 tests. | Worktrees removed. | implementation.md |
| 2026-09-28 | 2.8 | plan change | The plan's `resolve()` indexed `doc.joints[ref.existing]` unchecked; `"constructor"` reached `notFound` only through a later NaN path. | Agent guarded it with `isValidId`; plan line revised to match. | implementation.md deviation |
| 2026-09-28 | 2.10 follow-up | issue / spec change | User: "favour correctness". Inner miters now clamped (`limitSide`): U 0.05 m middle wall → triangle `[(0.025,0.1),(-0.1,-0.1),(0.15,-0.1)]`; 5° walls no longer spike; sweep of 1071 valid L/U configurations all simple. Needed a 2·EPS merge gap (literal rule left 0.13 mm gaps that `isSimplePolygon` flags) and dropping repeated points. Leftovers: a short H bar gets a 2-point outline with no area; a sub-mm edge next to a nearly straight far join. | Spec §3.5 rewritten; README contract comment. | domain-geometry.md (decision, Don'ts), implementation.md |
| 2026-09-28 | 2.9 | note | Test titled "rejects too-short, invalid and topology-breaking lengths" has no topology case (agent probe: lengthening an interior wall to 10 m returns `topology`). `setWallLength("toString")` is refused with "Joint not found" instead of "Wall not found". | For the wave 2 review fixes; `execute` (2.18) guards IDs first. | none |
| 2026-09-28 | wave 2 review | issue / spec change | Spec reviewer: wave 2 matches plan and spec, but (1) pre-existing from 2.10: outlines never pass through the joint, so at every joint with 3+ walls a triangle is uncovered — the demo divider shows a 20 cm notch at both ends ((2.9,0.1),(3.1,0.1),(3,−0.1)); (2) `setWallLength` indexed an unchecked ID; (3) its test title promised a topology case; plus untested spec behaviour. Clamp verified on 60,000 configurations; demo-scale outlines byte-identical to pre-clamp. | Fix agent (`d990161`, `5276cae`): outlines pass through joints with 3+ walls (coverage tests for the demo T, Y and X; H bar now a 0.01 m² diamond; new T/H/X/fan sweep 2141 valid configurations all simple and CCW); `setWallLength` guards ID and `keep`; topology test; tests for unsupported boundary, labels in unavailable rooms, addWall wall ties, opId checks, non-finite points, final-validation rejection (`invalid`, I6). Domain 118 tests. | domain-geometry.md, implementation.md, spec §3.5 |
| 2026-09-28 | wave 2 review fixes | issue (accepted) | Short-wall slivers: when a wall under ~2× thickness has an inner corner clamped, the neighbour's matching corner is not, so part of a body is in no outline (466 of 1496 short-wall configurations; e.g. T with 0.05 m stem leaves ≈0.0075 m²). Not demo scale. | Accepted and stated in spec §3.5; possible later fix: neighbours share clamped corners, or render bodies plus joint caps. Risk note for phase 4 and S1. | domain-geometry.md (limitation + Don't) |
| 2026-09-28 | wave 2 review | note | For the gate report: reused-opId check is a prefix test ("a" refused after "a/b"); a label exactly on a new divider becomes an orphan; a label in a room whose walk repeats a joint is an orphan and "no enclosing walls" is then misleading; `faceAt` on a nested room's wall returns the outer room (nested rooms deferred); insertion-order and atomic-split tests are weak (no competing candidates / input keys only). | None now. | none |
| 2026-09-28 | wave 2 code review | issue / spec change | Approve with minor fixes. Important: (1) `setWallLength` to the current length produced a joint put 22–29% of the time (float round trip), i.e. noise commits; (2) read-only results were one level deep (`zones(doc)[0].face.ring[0].x = 99` type-checked). Minor: a label inside an unsupported inner room resolved to the outer room; TIE tolerance never exercised; divider patch unchecked; plan 2.15 snippet no longer compiles (TS2345 with readonly faces); magic 120. Timing on 312 walls: addWall 5.4 ms, moveJoints 5.1 ms, zones 2.2 ms, outlines 0.7 ms; domain suite 278 ms. Determinism: 3000 random addWall attempts, forward vs reversed tables, 0 mismatches. | Fix agent `ff99faf`: `SAME_LENGTH` early return with empty patch; rings/floors `readonly Readonly<Point>[]` plus `@ts-expect-error` type tests; innermost face first, then refuse unsupported/boundary; near-tie tests (fail with TIE = 0); divider dependencies and `before` pinned; `MAX_OP_ID_LENGTH`. Domain 124 tests. Plan 2.15 revised (`Map<string, Face>`), README contract deepened, spec §3.6 orphan rule clarified. Skipped: splitting `add-wall.ts`. | domain-geometry.md (3 decisions, 2 Don'ts) |
| 2026-09-28 | 2.14, 2.15 | process | Wave 3: two parallel Opus agents from `595fc59`. Both red for the expected reason (module missing), green with the plan's counts (4, 10), then the planned guard deviation red → green (5, 11). No lint or type fixes. Cherry-picked `7086f82`, `56145eb`; domain 17 files, 140 tests. | Worktrees removed. | none |
| 2026-09-28 | 2.14, 2.15 | plan change | The plan's `renameZone` and `deleteEntities` indexed tables with unchecked IDs, against the wave 1 Don't. Unguarded: `renameZone("constructor")` wrote a bogus label; deleting `walls/constructor` returned `ok` with a dependency `{ table: "joints", id: undefined }`. | Controller told both agents before dispatch: `isValidId` guard plus one test each. Plan code and counts revised to match (identical to the committed files). | implementation.md deviation |
| 2026-09-28 | 2.15 | issue | Merged names are cut with `.slice(0, 200)`, which can split a surrogate pair: "x"×196 + " / " + "😀" ends in a lone high surrogate (passes `isValidName`, survives JSON as `\ud83d`, renders as a broken glyph). | For the wave 3 review fixes. | none yet |
| 2026-09-28 | 2.15 | issue / spec question | The plan's rule counts labels ("exactly two surviving labels from two different faces"); spec §3.6 and §11 defer "three-or-more-room merges". Deleting both dividers of three rooms in a row where only rooms 1 and 3 are labelled gives "One / Three". Plausible (an unlabelled room contributes no name) but the spec doesn't say which reading holds. | For the wave 3 spec review. | none yet |
| 2026-09-28 | 2.15 | note | Agent probes: deleting the divider's joint S1 opens the room (walls L, R, T1, T2 remain as a U) and both labels become orphans, patch with 4 deletes; three labels in one merged room stay unchanged; no deletion from a valid document returned `invalid`. A label sitting on the divider is an orphan before and is not merged after, so the merged room shows two labels (allowed by §3.6). Removing one wall of a free-standing inner room merges its label into the outer room's (nested rooms deferred, §11). Joint cleanup scans the whole document, so on an input that already breaks I3 it removes an unrelated joint that is not in the dependencies (valid documents only). | None. | none |
| 2026-09-28 | 2.14 | note | Agent probes: renaming to the same name gives an empty patch; an orphan label does not make its room "labelled"; a dangling wall inside a room is not a `labelZone` dependency (it doesn't bound the face). `isValidName` accepts `""`, so both commands accept an empty name (spec silent; phase 3 should supply a default name). `labelZone` reads `cmd.at.x` without checking `cmd.at` (commands come only from the typed editor). | For gate question 1 and phase 3. | none |
| 2026-09-28 | wave 3 review | issue / spec change | Spec reviewer: compliant with fixes; code identical to the revised plan; ~25 probes (forward/inverse/redo, sorted unique dependencies, `before` values, deep-frozen inputs, validity) all clean. Real defect: the merged-name cut split a surrogate pair. Spec wording: (1) spec counted rooms ("three-or-more-room merges"), code counts labels; (2) "complete names" vs the 200 cut, never stated in the spec; (3) §4.1 "incident walls … used to determine cleanup" read as including the walls that keep an endpoint alive: two users deleting the two walls at a corner write disjoint entities and the second is rejected `invalid` (I3), not `conflict`; (4) empty names unspecified. Ten spec behaviours had no test. | Fix agent (`5eafa38`, `2f3e4f1`): `cutName` keeps surrogate pairs whole; tests for redo, the exact merge patch, a divider through a joint, deleting S1, three rooms (three labels unchanged, two labels → "One / Three"), a closet with unavailable area, deep-frozen inputs, messages and label-only dependencies, non-finite positions, narrow and repeated-joint rooms, orphan and same-name renames, empty names. Domain 17 files, 160 tests. Decisions: keep counting labels, keep Delete dependencies (the `invalid` outcome is §4.0 case 3), allow empty names. Spec I8, §3.6 (label-count rule, cut rule, concurrent label + merge), §4.1 Delete row and corner-deletion example, §11 item 5; plans 2.15 and phase 5 wording. | domain-geometry.md (3 decisions, 2 Don'ts), implementation.md (deviation, tooling note), process.md lesson 23, INDEX.md |
| 2026-09-28 | wave 3 review | note | For the gate report: `labelZone` accepts a point inside the wall body (0.05–0.099 m from the centreline; §3.6 measures the boundary on the centreline; phase 5's `narrowRoomDoc` relies on it), so a tag can sit over a wall; label-ID order can surprise ("L10" before "L9"); through `execute` bad IDs give `invalidInput` "Invalid ID", direct calls `notFound`; `assertNever` on an unknown table and a missing `at` throw (typed editor commands only); "This room already has a label" rarely shows because the Zone tool selects the existing zone first. | None. | none |
| 2026-09-28 | wave 3 code review | issue / spec change | Approve with fixes. Important: (1) with an unlabelled room between the two labelled ones ("One / Three"), the merge's dependencies missed the middle room's walls, so a collaborator deleting one of them first opened the room and the merge was still accepted (no serial order gives that result); (2) labels' "used ID" test passed for the wrong reason (duplicate placed in the labelled room). Minor: stale "two-room" comments and a process-history comment in src; `""` + "Dining" merged to " / Dining"; Delete dependencies unpinned; cleanup scanned the whole document; no-op identity lost (`mergeLabels` always copied, same-name rename returned a new doc); `mergeLabels` wrote `deps` silently; duplicated `deepFreeze`. Timing on 312 walls (144 labelled rooms): `validateDocument` 5.5 ms, cold `zones` 5.6 ms, delete a label 5.9 ms, delete a wall with merge 10.9 ms (15.8 ms cold), delete a joint 15.9 ms, `labelZone` 2.1 ms. | Fix agent (`00759d3`, `0025be1`, `d44b984`): merged face's boundary in dependencies; empty names skipped in the join; cleanup only at deleted walls' endpoints (`jointsToDelete` gone; every deleted joint is a dependency); `after`/`doc` returned for no-ops; comments; tests (J3 cascade dependencies exact, used-ID message, identity). Domain 17 files, 162 tests. Skipped: `at: null` throws (same as `moveJoints`/`addWall`; typed editor commands only). Spec §3.6 (empty names, merged-face dependency) and §4.1 Delete row; plan 2.14/2.15 code blocks = final code. | domain-geometry.md (decisions, Don't), process.md lesson 23, implementation.md deviation |
| 2026-09-28 | 2.18 | process | Wave 4: one Opus agent from `a4f9fed`. Red for the expected reason (module `../src/commands/execute` missing), green with the plan's 9 tests, `pnpm check` clean, no lint or type fixes; the controller diffed the four files against the plan's code blocks: identical. The agent's Bash calls were then blocked by the auto-mode classifier (no verdict), so it could not commit; the controller deleted its placeholder probe, committed `f19ed25` from the worktree and cherry-picked it as `b0effc9`. Domain 18 files, 171 tests. | Worktree removed. EXECUTION.md gotcha. | none |
| 2026-09-28 | 2.18 | note | Agent findings: the ID guard skips `addWall`'s `opId` (checked by `addWall`) and `deleteEntities`' `table` (an unknown table throws in `assertNever`; typed commands only). Through `execute`, `labelZone`'s "Invalid label ID" and the per-command `notFound` for malformed IDs are unreachable ("Invalid ID" comes first). `rectangleRoom`'s "counter-clockwise" holds only for positive width and height (harmless: `addWall` ignores direction). The default `opPrefix` "room" means a second call on the same document should be refused as a reused operation ID (not verified). The `?? p0` fallbacks only satisfy the compiler. `index.ts`: every README contract item and non-internal extension is reachable; `applyMoves`, `boundedFaces`, `BoundedFace`, `insetFloor` and the single command functions are not. | For the wave 4 reviews. | none |
| 2026-09-28 | wave 4 review | issue / spec change | Spec reviewer: COMPLIANT; code identical to the plan; 14 round-trip probes on deep-frozen inputs (splits at both ends, reused joints, keep "b", multi-joint moves, divider-joint delete with merge, corner delete) all clean; 8 bad IDs × 10 ID fields all "Invalid ID"; the 42 names later phases import are exported with the right kind, internals are hidden. Found: `labelZone` missing from the guard test (removing its case stayed green); no-ops untested through `execute`, and a `moveJoints` no-op returned a new document; script IDs unpinned; immutability tested shallowly; `execute`'s comment overclaimed (label commands skip `validateDocument`, so an invalid input gives an ok, still-invalid result); `rectangleRoom` "counter-clockwise" and dead `?? p0`. | Fix agent (`361ebe0`, `3147bdd`): `moveJoints` no-op keeps identity (red first); guard list covers every ID field (mutation-checked); no-op test over three commands; `rectangleRoom` IDs, "Operation ID already used" on reuse, a second room with prefix "b"; `deepFreeze` in the round trips (mutation-checked); comments. Domain 18 files, 173 tests. Spec §3.4: label commands shape-check only. Plan 2.7 and 2.18 code blocks = final code. | domain-geometry.md (decision, no-op row, Don't), implementation.md deviation, process.md lesson 24 |
| 2026-09-28 | wave 4 review | note | For the gate report: `execute` still throws on untyped input (unknown `table` or `type`, missing `at`), against spec §8 "never exceptions"; accepted for typed commands only, and `commandIds` is the place for a shape check if scripts or an AI agent ever send JSON commands. A rectangle with negative width or height is traced clockwise and gives the same area. | None. | none |
| 2026-09-28 | wave 4 code review | issue / plan change | Approve with fixes. Important: (1) the ID guard exists in `execute` and in every command, with comments implying only `execute` protects lookups; (2) round-trip tests passed for a command forced to a no-op (`apply(doc, invert(empty))` = `doc`). Minor: no-op identity per command; `MIGRATIONS` a mutable exported array (any importer could `push`); `AREA_UNAVAILABLE` public while its "unsupported boundary" sibling was private; redundant immutability test, test titles/comments, no test through `src/index.ts`; process history in `index.ts`; `rectangleRoom` comment silent on reused prefixes. Phase 3 impact: none (`runCommand` skips empty patches; no later phase switches on `error.kind`). | Fix agent (`6dc5421`, `b20040c`): round trips assert a write (red with a no-op `setWallLength`); `execute` returns the input document for any empty patch (mutation-checked), `moveJoints` flag removed; guard kept with honest comments (one message, future commands covered); `readonly` `MIGRATIONS` (red: unused `@ts-expect-error`); `AREA_UNAVAILABLE` internal; immutability test deleted, §3.1 script test through `import * as domain from "../src"`, per-case document builders; comments. Domain 18 files, 173 tests. Skipped: named exports instead of `export *` (plan change for little gain). Plan 2.7, 2.17, 2.18 code blocks = final code; Contract extensions revised. | domain-geometry.md (no-op row, ID-guard row, 2 Don'ts), implementation.md deviation, process.md lesson 24 |
| 2026-09-28 | 2.19 | process | Wave 5: one Opus agent from `c666b07`. No red step (tests of existing code); both files passed on the first run with no expected value changed; `demo-geometry.test.ts` identical to the plan. Cherry-picked `fa88e78`; domain 20 files, 179 tests. | Worktree removed. | none |
| 2026-09-28 | 2.19 | plan change | The plan's `performance.test.ts` failed `tsc -p tsconfig.test.json`: domain tests compile with `lib: ES2022, types: []`, so `performance` (TS2304) and `console` (TS2584) are unknown. The planning scratch run's config evidently differed (not investigated). Found by the controller before dispatch. | Two local `declare const` lines in the test file; no tsconfig or `@types` change (keeps the core free of DOM/Node globals). Plan code block revised. | implementation.md (tooling note, deviation) |
| 2026-09-28 | 2.19 | note | Timing, 3 runs on 312 walls: `validateDocument: 14.2 ms, zones: 6.7 ms`; `13.4 ms, 7.0 ms`; `13.9 ms, 6.9 ms`. Close to the planning run (14 / 8 ms), under the ~50 ms flag. The test times the first call in its worker; the wave 1 code review measured 4.2 ms for `validateDocument` (5.4 / 5.1 ms were whole `addWall` / `moveJoints` commands), probably warmer. Not a performance claim. | For gate question 3. | implementation.md tooling note |
| 2026-09-28 | 2.19 | note | `zones` orders rooms by face key (sorted wall IDs joined with `\|`), not by position; labels within a zone by label ID. Demo: left room (L1) first, so step 5 gives `[10.64, 9.94]`. Demo IDs match the table above (`b/w0.a` stays `a/j1` with `keep: "a"`; splits keep the ID on the `a` side). | For phase 3: tests must not assume rooms in position order. | none |
| 2026-09-28 | wave 5 review | issue | Spec reviewer: COMPLIANT_WITH_FIXES; both files identical to the plan; demo arithmetic checked by hand (step 5: 2.8 × 3.54862 = 9.936 m²); grid 169 / 312 / 144 confirmed; `declare const` judged the minimal sound option. No behaviour defect. Weak tests: areas compared in zone-sort order and labels never tied to rooms (swapping L1/L2 stayed green); step 5 kept end, step 3 fragments `e/w1`/`e/w2`, step 6 input and exact violation list unpinned; 2.7's "leaving the document unchanged" never checked it; the 0.10 m square never went through `zones` or `validateDocument`; the timing is one first call. | Fix agent `adfd760`: label → area map, pinned IDs, frozen step 6 input with the exact I5 list, 2.7 crossing test checks the input, 0.10 m square test, warm medians. Each new assertion mutation-checked (label swap, duplicated violations, writing into the input, flipped fragment). Domain 20 files, 181 tests. Two overclaims in this log corrected. Plan 2.7 and 2.19 code blocks = final code. | process.md lesson 25 |
| 2026-09-28 | wave 5 review | note | Warm medians on 312 walls (20 runs, 3 runs of the test): `validateDocument` 5.8–6.1 ms, `zones` (uncached documents) 2.5–2.6 ms, `execute(moveJoints)` 5.9–6.2 ms; first call 13.5–13.9 ms (48.2 ms once inside the full suite). A drag preview costs about one `validateDocument`; all under the ~50 ms flag. Step 4 cannot tell the labels apart by area (both 10.64); step 5 does. | For gate question 3. | implementation.md tooling note |
| 2026-09-28 | wave 5 code review | issue | Approve with fixes. Important: the step 5 area check rounded 9.936137… with `toFixed(2)`, 0.0011 m² above the 9.93 boundary, so a harmless inset change could fail it for the wrong reason. Minor: divider joints and step 2 wall count unpinned; JSON snapshot idiom; the `{ existing }` endpoints the editor sends untested; timing lines hidden from agents without `--reporter=verbose`; median `?? 0` and a `docs[i] ?? doc` fallback that could time a cached `zones`; log and comment wording. File runs ~440 ms, ~60% of the domain suite. | Fix agent `17d7d16`: `expect.closeTo` / `toBeCloseTo` on raw areas with the derivation 2.8 × (3.75 − 0.1 − 0.1·√(1 + 1/36)) (the controller's brief had a wrong formula; the agent verified numerically and corrected it); divider joints, wall count, `toEqual(step5())`; new test: the same room drawn with `{ existing }` endpoints equals step 2; `median` over prebuilt inputs, `?? NaN`; "first call:" label. Mutation-checked (length 3.49 → area red on its own; wrong `existing` → red). Domain 20 files, 182 tests. Timing: first call 15.4 / 8.9 and 15.7 / 7.3 ms; warm 7.0 / 3.0–3.1 / 7.3–7.6 ms. Skipped: `runs = 10`, merging the two unavailable-area tests. Plan 2.19 code blocks = final code; ID table notes fixture opIds. | implementation.md tooling note |
| 2026-09-28 | Gate 2 | issue | Completion-criteria check: the insertion-order test had no competing candidates (reordering could not matter). | Fix agent `aaf6e42`: `it.each` over the divider, joint tie, wall tie and both near-ties, forward vs reversed tables, whole results compared. Mutation (`Object.keys` instead of `sortedIds` in `resolve`): the 4 new cases red, the old case green. Domain 20 files, 186 tests. Report `docs/reports/gate-2-domain.md`. | process.md lesson 25 (same lesson) |
