import { describe, expect, it } from "vitest";
import {
  MIN_ZONE_SIZE, OBJECT_KINDS, SIDE_IDS, SIDE_ZONE_KEYS, emptyDocument, execute, rectangleRoom, unwrap, zoneExtent, type Command, type Document,
  type EntityRef, type Side,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../src/state";
import { handles, type Handle } from "../src/view/handles";
import { localState, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// Zone handle drags under random input (furnish.15, .20, .61, .62; AC-18, AC-19): a 20 × 20 room, one piece at
// (10, 10), no wall within 6 m of it, so no face snap applies. A drag keeps the stored zone at least 0.10 m deep and
// long and inside its side, writes one side, and is one undo step. The hit circles are zone-chips.test.ts's fuzz.

const room = rectangleRoom({ x: 0, y: 0 }, 20, 20).reduce((doc: Document, cmd) => unwrap(execute(doc, cmd)).doc, emptyDocument());
const X: EntityRef = { table: "placements", id: "x/p0" };
const ALL_ON = { front: true, back: true, left: true, right: true };

/** The Select tool, idle, with x/p0 selected, at `zoom` centred on (cx, cy). */
function shellFor(doc: Document, zoom: number, center: Point = { x: 10, y: 10 }): FakeShell {
  const host = new FakeHost();
  const s = localState(host, doc);
  const state: EditorState = { ...s, selection: [X], camera: { ...s.camera, center, zoom } };
  return new FakeShell(state, host);
}
type ZoneHandle = Extract<Handle, { kind: "zoneDepth" | "zoneEnd" }>;
const zoneHandles = (shell: FakeShell): ZoneHandle[] =>
  handles(shell.state, shell.doc()).flatMap((h) => (h.kind === "zoneDepth" || h.kind === "zoneEnd" ? [h] : []));
const keysOf = (doc: Document, side: Side): [number | null, number | null, number | null] => {
  const z = doc.placements["x/p0"]?.zones;
  const [d, s, e] = SIDE_ZONE_KEYS[side];
  return [z?.[d] ?? null, z?.[s] ?? null, z?.[e] ?? null];
};
const lengthOf = (doc: Document, side: Side): number => {
  const p = doc.placements["x/p0"];
  const object = p ? doc.objects[p.object] : undefined;
  const v = p ? (side === "front" || side === "back" ? object?.w[p.config] : object?.d[p.config]) : undefined;
  if (v === undefined) throw new Error("no size");
  return v;
};
/** Presses at `from`, moves to `to` and releases; the drag's target kind while moving. */
function dragHandle(shell: FakeShell, from: Point, to: Point, ctrl: boolean): string | null {
  shell.moveTo(from, { ctrl });
  shell.down(from, { ctrl });
  shell.moveTo(to, { ctrl });
  const tool = shell.state.tool;
  const target = tool.name === "select" && tool.state.kind === "moving" ? tool.state.target.kind : null;
  shell.up(to, { ctrl });
  return target;
}

describe("zone handle drags under random input (furnish.61, .62; AC-18, AC-19)", () => {
  it("dragging an end handle of a clamped zone past the other end stops 0.10 m short, accepted (furnish.62)", () => {
    // A bed 1.70 × 1.60 at (10, 10), front at y 8.4. Its left zone was stored { 0.6, 1.2, 0.5 } on a 2.10 side; on the
    // 1.60 side it reads clamped: start 1.2 · 1.5/1.7 = 1.0588235…, end 0.5 · 1.5/1.7 = 0.4411764…. Dragging the start
    // (head) handle past the foot end leaves a 0.10 m zone; rounding the moved inset to the mm would give 1.059 and a
    // zone 0.0998 long, which setZoneExtent refuses.
    const doc = withCommands(
      room,
      { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: "bed" }, at: { x: 10, y: 10 } },
      { type: "setZoneExtent", placementId: "x/p0", side: "left", extent: { depth: 0.6, start: 1.2, end: 0.5 } },
      { type: "setObjectSize", objectId: "x/o0", w: 1.7, d: { standard: 1.6 } },
    );
    const p = doc.placements["x/p0"];
    const before = p ? zoneExtent(doc, p, "left") : null;
    expect(before?.start).toBeCloseTo(1.2 * 1.5 / 1.7, 12);
    const shell = shellFor(doc, 400, { x: 9.15, y: 9.2 });
    const h = zoneHandles(shell).find((x) => x.kind === "zoneEnd" && x.side === "left" && x.end === "start");
    if (!h || !before) throw new Error("no start handle on the left zone");
    const past = shell.state.undo.past.length;
    expect(dragHandle(shell, h.at, { x: h.at.x, y: h.at.y - 1 }, false)).toBe("zoneEnd");
    expect(shell.view().toast).toBeNull();
    expect(shell.state.undo.past).toHaveLength(past + 1);
    const [depth, start, end] = keysOf(shell.doc(), "left");
    expect([depth, end]).toEqual([0.6, before.end]);
    expect((start ?? NaN) + (end ?? NaN) + MIN_ZONE_SIZE).toBeLessThanOrEqual(1.6 + 1e-9);
    expect((start ?? NaN) + (end ?? NaN) + MIN_ZONE_SIZE).toBeCloseTo(1.6, 9);
  });

  it("a zone handle drag keeps the zone at least 0.10 m deep and long and inside its side, writes one side, and is one undo step (fuzz)", () => {
    let seed = 13;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647; // Park–Miller, reproducible
    const pick = <T>(xs: readonly T[]): T => {
      const x = xs[Math.floor(random() * xs.length)];
      if (x === undefined) throw new Error("empty");
      return x;
    };
    const kinds = OBJECT_KINDS.filter((k) => !k.retired && k.configs.some((c) => c.zone !== null));
    let withHandles = 0;
    let ellDrags = 0;
    const ellKinds = kinds.filter((k) => k.arms !== null);
    let clamped = 0;
    let noOps = 0;
    for (let trial = 0; trial < 400; trial++) {
      const kind = random() < 0.25 ? pick(ellKinds) : pick(kinds); // a quarter on `L` kinds, whose front is two strips
      const config = pick(kind.configs.filter((c) => c.zone !== null));
      const rotation = Math.floor(random() * 360);
      // An `L` keeps its arms (catalog.12): sides from the deeper arm + 0.10 (0.70, the sofa's 1.00). Its front zone's
      // strips are each trimmed from its far end, `start` along d − t1 and `end` along w − t2, each 3 − arm long on the
      // 3 × 3 piece (catalog.13), keeping 0.10.
      const ell = kind.arms;
      const arm = ell ? Math.max(ell.back, ell.left) : 0;
      const fit = (v: number): number => (ell ? arm + 0.1 + (v - 0.3) * ((2.9 - arm) / 2.7) : v);
      const w = fit(0.3 + random() * 2.7);
      const winder = kind.stair?.shape === "winder"; // deeper than wide by 0.05 at least (I19, steps.09)
      const d = winder ? Math.max(fit(0.3 + random() * 2.7), w + 0.06) : fit(0.3 + random() * 2.7);
      let zoom = 20 + random() * 280;
      const allD = (v: number) => Object.fromEntries(kind.configs.map((c) => [c.id, v]));
      // Half the trials store one side first, on a 3 × 3 piece; the resize after it may clamp it when read.
      const pre: Command[] = [];
      let preLabel = "none";
      let preSide: Side | null = null;
      if (random() < 0.5) {
        const side = pick(SIDE_IDS);
        preSide = side;
        // A clamped zone reads exactly 0.10 m long, which shows handles only from 320 px/m: a third of these trials
        // zoom in that far (furnish.62's cap).
        if (random() < 1 / 3) zoom = 320 + random() * 680;
        const start = random() * 2.9;
        const ellFront = ell !== null && side === "front";
        const extent = ellFront
          ? { depth: 0.1 + random() * 1.9, start: start * ((2.9 - arm) / 2.9), end: random() * (2.9 - arm) }
          : { depth: 0.1 + random() * 1.9, start, end: random() * (2.9 - start) };
        pre.push({ type: "setZoneExtent", placementId: "x/p0", side, extent });
        preLabel = `${side} {${extent.depth}, ${extent.start}, ${extent.end}}`;
      }
      const doc = withCommands(
        room,
        { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: kind.id }, at: { x: 10, y: 10 }, rotation, config: config.id },
        { type: "setObjectSize", objectId: "x/o0", w: 3, d: allD(winder ? 3.06 : 3) },
        { type: "setZoneSides", placementId: "x/p0", sides: ALL_ON },
        ...pre,
        { type: "setObjectSize", objectId: "x/o0", w, d: allD(d) },
      );
      const shell = shellFor(doc, zoom);
      const hs = zoneHandles(shell);
      if (hs.length === 0) continue;
      withHandles++;
      const onPre = hs.filter((x) => x.side === preSide);
      const h = pick(onPre.length > 0 ? onPre : hs);
      shell.state = { ...shell.state, camera: { ...shell.state.camera, center: h.at } };
      const angle = random() * 2 * Math.PI;
      const px = 6 + random() * 394;
      const ctrl = random() < 1 / 3;
      const to = { x: h.at.x + Math.cos(angle) * px / zoom, y: h.at.y + Math.sin(angle) * px / zoom };
      const handleName = h.kind === "zoneDepth" ? `zoneDepth ${h.side}` : `zoneEnd ${h.side} ${h.end}`;
      const label = `trial ${trial}: ${kind.id} ${config.id} ${rotation}° ${w}×${d} at ${zoom} px/m, pre ${preLabel}, ${handleName} by ${px} px at ${angle} rad${ctrl ? " Ctrl" : ""}`;

      const p0 = doc.placements["x/p0"];
      const resolved = p0 ? zoneExtent(doc, p0, h.side) : null;
      if (!p0 || !resolved) throw new Error(`${label}: no zone`);
      const L = lengthOf(doc, h.side);
      const stored0 = keysOf(doc, h.side);
      if (stored0[0] !== null && (stored0[1] !== resolved.start || stored0[2] !== resolved.end)) clamped++;
      const past = shell.state.undo.past.length;

      expect(dragHandle(shell, h.at, to, ctrl), `${label}: drag target`).toBe(h.kind);
      expect(shell.view().toast, `${label}: toast`).toBeNull();
      const after = shell.doc();
      const [depth, start, end] = keysOf(after, h.side);
      if (depth === null || start === null || end === null) throw new Error(`${label}: side not stored`);
      if ([depth, start, end].every((v, i) => v === stored0[i])) {
        noOps++; // the drag landed on the stored zone: nothing to commit
        expect(shell.state.undo.past.length, `${label}: no-op undo`).toBe(past);
      } else {
        expect(shell.state.undo.past.length, `${label}: one undo step`).toBe(past + 1);
      }
      for (const s of SIDE_IDS) if (s !== h.side) expect(keysOf(after, s), `${label}: ${s} unchanged`).toEqual(keysOf(doc, s));
      expect(depth, `${label}: depth`).toBeGreaterThanOrEqual(MIN_ZONE_SIZE);
      expect(start, `${label}: start`).toBeGreaterThanOrEqual(0);
      expect(end, `${label}: end`).toBeGreaterThanOrEqual(0);
      if (ell && h.side === "front") {
        ellDrags++;
        expect(start + MIN_ZONE_SIZE, `${label}: left strip`).toBeLessThanOrEqual(lengthOf(doc, "left") - ell.back + 1e-9);
        expect(end + MIN_ZONE_SIZE, `${label}: back strip`).toBeLessThanOrEqual(L - ell.left + 1e-9);
      } else {
        expect(start + end + MIN_ZONE_SIZE, `${label}: length`).toBeLessThanOrEqual(L + 1e-9);
      }
      if (h.kind === "zoneDepth") {
        expect([start, end], `${label}: insets kept`).toEqual([resolved.start, resolved.end]);
      } else if (h.end === "start") {
        expect([depth, end], `${label}: depth and end kept`).toEqual([resolved.depth, resolved.end]);
      } else {
        expect([depth, start], `${label}: depth and start kept`).toEqual([resolved.depth, resolved.start]);
      }

      shell.key("z", { meta: true });
      expect(shell.doc().placements["x/p0"]?.zones, `${label}: undo`).toEqual(p0.zones);
    }
    const counts = `${withHandles} trials with handles, ${clamped} on clamped zones, ${noOps} no-ops, ${ellDrags} on L fronts`;
    expect(withHandles, counts).toBeGreaterThanOrEqual(250);
    expect(clamped, counts).toBeGreaterThan(20);
    expect(ellDrags, counts).toBeGreaterThan(15); // `L` front strips (catalog.27)
  });
});
