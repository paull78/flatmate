import { describe, expect, it } from "vitest";
import { SIDE_IDS, clearanceWarnings, distance, useZones, zoneExtent, type Command, type Document, type EntityRef, type Side } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { dragTry } from "../src/tools/drag";
import { hitTest } from "../src/tools/hit-test";
import { idleTool } from "../src/tools/types";
import { zoneFrame } from "../src/snapping/zone-drag";
import type { EditorState } from "../src/state";
import { handles } from "../src/view/handles";
import { zoneChips } from "../src/view/zone-chips";
import { bed160x200, localState, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { FakeRemote } from "./fake-remote";
import { PROJECT } from "./shared-builders";
import { COLORS } from "../src/view/colors";

// Zone handles (furnish.15, .20; AC-18, AC-19): a depth handle on the middle of each active zone's outer edge and an
// end handle on the middle of each end side, halfway across the depth. At 80 px/m the bed bed/p0 spans x 2.2–3.8,
// y 1.9–3.9; its left band (0.6 deep, 0.45 m short of the head) is x 1.6–2.2, y 1.9–3.45, its end handles at x 1.9.
const bedTwo = (): Document => withCommands(
  roomDoc(),
  { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } },
  bed160x200("bed/o0"),
  { type: "copyState", opId: "n", from: "s0", name: "Night" },
);
const leftZone = (start: number, end: number): Command =>
  ({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: { depth: 0.6, start, end } });
const BED: EntityRef = { table: "placements", id: "bed/p0" };
const BODY = { x: 3, y: 2.9 };
/** A wardrobe 1.2 × 0.6 at (3, 3.9): x 2.4–3.6, y 3.3–3.9, its front zone 0.6 deep. */
const ward = (...more: Command[]): Document => withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 3.9 } }, ...more);
const WARD: EntityRef = { table: "placements", id: "w/p0" };

const near = (x: number, y: number) => ({ x: expect.closeTo(x, 9), y: expect.closeTo(y, 9) });

function selecting(doc: Document, selection: EntityRef[], zoom = 80): EditorState {
  const s = localState(new FakeHost(), doc);
  return { ...s, selection, camera: { ...s.camera, zoom } };
}
const zoneHandles = (state: EditorState, doc: Document) => handles(state, doc).filter((h) => h.kind === "zoneDepth" || h.kind === "zoneEnd");
const sortedPoints = (ps: readonly Point[]): string[] => ps.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`).sort();

describe("zone handles (furnish.15, .20; AC-18, AC-19)", () => {
  it("a selected bed shows three handles per active zone, after its grips (furnish.20)", () => {
    const doc = bedTwo();
    expect(handles(selecting(doc, [BED]), doc)).toEqual([
      { kind: "side", placementId: "bed/p0", side: "right", at: near(3.8, 2.9), normal: near(1, 0), hittable: true },
      { kind: "side", placementId: "bed/p0", side: "left", at: near(2.2, 2.9), normal: near(-1, 0), hittable: true },
      { kind: "side", placementId: "bed/p0", side: "front", at: near(3, 1.9), normal: near(0, -1), hittable: true },
      { kind: "side", placementId: "bed/p0", side: "back", at: near(3, 3.9), normal: near(0, 1), hittable: true },
      { kind: "rotate", placementId: "bed/p0", at: near(3, 1.6), hittable: true },
      { kind: "zoneDepth", placementId: "bed/p0", side: "left", at: near(1.6, 2.675), normal: near(-1, 0), hittable: true },
      { kind: "zoneEnd", placementId: "bed/p0", side: "left", end: "start", at: near(1.9, 3.45), along: near(0, -1), hittable: true },
      { kind: "zoneEnd", placementId: "bed/p0", side: "left", end: "end", at: near(1.9, 1.9), along: near(0, -1), hittable: true },
      { kind: "zoneDepth", placementId: "bed/p0", side: "right", at: near(4.4, 2.675), normal: near(1, 0), hittable: true },
      { kind: "zoneEnd", placementId: "bed/p0", side: "right", end: "start", at: near(4.1, 3.45), along: near(0, -1), hittable: true },
      { kind: "zoneEnd", placementId: "bed/p0", side: "right", end: "end", at: near(4.1, 1.9), along: near(0, -1), hittable: true },
    ]);
  });

  it("zoneFrame's band is the band the outline draws", () => {
    for (const doc of [bedTwo(), withCommands(bedTwo(), leftZone(0, 0))]) {
      const drawn = useZones(doc).get("bed/p0") ?? [];
      for (const side of SIDE_IDS) {
        const frame = zoneFrame(doc, "bed/p0", side);
        const quad = drawn.find((z) => z.side === side)?.quad;
        if (side === "front" || side === "back") {
          expect(frame, side).toBeNull();
          continue;
        }
        expect(frame?.band ? sortedPoints(frame.band) : null, side).toEqual(quad ? sortedPoints(quad) : "no band");
      }
    }
  });

  it("handles show only while the band is at least 32 px deep and long, with float noise allowed", () => {
    const doc = bedTwo();
    expect(handles(selecting(doc, [BED], 53), doc)).toHaveLength(5); // 31.8 px deep
    expect(handles(selecting(doc, [BED], 54), doc)).toHaveLength(11); // 32.4 px
    const short = withCommands(doc, leftZone(0, 1.6)); // 0.4 m long: 31.999999999999993 px at 80 px/m
    expect(handles(selecting(short, [BED]), short)).toHaveLength(11);
    const shorter = withCommands(doc, leftZone(0, 1.62)); // 30.4 px
    expect(zoneHandles(selecting(shorter, [BED]), shorter).map((h) => h.side)).toEqual(["right", "right", "right"]);
  });

  it("front-zone handles sit at least 40 px out, clear of the rotation grip", () => {
    const doc = ward();
    const at60 = selecting(doc, [WARD], 60); // 36 px deep
    expect(zoneHandles(at60, doc).map((h) => h.at)).toEqual([near(3, 3.3 - 40 / 60), near(2.4, 3.3 - 20 / 60), near(3.6, 3.3 - 20 / 60)]);
    expect(zoneChips(at60, doc).find((c) => c.side === "front")?.at).toEqual(near(3, 3.3 - 56 / 60));
    expect(handles(at60, doc).find((h) => h.kind === "rotate")?.at).toEqual(near(3, 2.9));
    const at80 = selecting(doc, [WARD], 80); // 48 px deep
    expect(zoneHandles(at80, doc).map((h) => h.at)).toEqual([near(3, 2.7), near(2.4, 3.0), near(3.6, 3.0)]);
    expect(zoneChips(at80, doc).find((c) => c.side === "front")?.at).toEqual(near(3, 2.5));
    // A band x 3.0–3.6: its start handle, on the side's middle, sits right below the rotation grip, 16 px away, not
    // halfway across (20 px out, 4 px from the grip); its far end, 36 px along, stays halfway across.
    const inset = ward({ type: "setZoneExtent", placementId: "w/p0", side: "front", extent: { depth: 0.6, start: 0.6, end: 0 } });
    const ends = zoneHandles(selecting(inset, [WARD], 60), inset).filter((h) => h.kind === "zoneEnd").map((h) => h.at);
    expect(ends).toEqual([near(3, 3.3 - 40 / 60), near(3.6, 3.3 - 20 / 60)]);
  });

  it("zone end handles sit at the middle of the end sides (AC-02)", () => {
    // The left band x 1.6–2.2, y 1.9–3.45 (0.60 deep, insets 0.45 / 0): its ends 0.30 m out from the side, not 0.60.
    const doc = bedTwo();
    const ends = zoneHandles(selecting(doc, [BED]), doc).filter((h) => h.kind === "zoneEnd" && h.side === "left").map((h) => h.at);
    expect(ends).toEqual([near(2.2 - 0.3, 3.45), near(2.2 - 0.3, 1.9)]);
    expect(hitTest(selecting(doc, [BED]), { x: 1.6, y: 3.45 })?.handle).toBeUndefined(); // the old outer corner
  });

  it("a front zone's end handle near the grip moves out clear of it, and no two hit circles overlap (AC-02)", () => {
    // A desk 1.20 × 0.60 at (3, 3.9): x 2.4–3.6, front edge y 3.3, rotation grip (3, 3.3 − 24/80). Its centred 0.70
    // front zone never brings an end within 16 px of the side's middle while the handles show: at 46 px/m the band is
    // 32.2 px long and each end 16.1 px from the middle, so both stay halfway across.
    const desk = (...more: Command[]): Document =>
      withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 3.9 } }, ...more);
    const D: EntityRef = { table: "placements", id: "d/p0" };
    const centred = desk();
    const f = zoneFrame(centred, "d/p0", "front");
    if (!f) throw new Error("no front zone");
    const half = Math.max(f.extent.depth * 46, 40) / 2 / 46;
    expect(zoneHandles(selecting(centred, [D], 46), centred).filter((h) => h.kind === "zoneEnd").map((h) => h.at))
      .toEqual([near(2.65, 3.3 - half), near(3.35, 3.3 - half)]);
    // Insets 0 / 0.50: the band x 2.4–3.1, 0.70 deep (56 px). Its far end, 8 px from the middle, sits 40 px out, not
    // 28; its near end, 48 px away, stays halfway across.
    const inset = desk({ type: "setZoneExtent", placementId: "d/p0", side: "front", extent: { depth: 0.7, start: 0, end: 0.5 } });
    const state = selecting(inset, [D], 80);
    const hs = handles(state, inset);
    expect(hs.flatMap((h) => (h.kind === "zoneEnd" && h.side === "front" ? [h.at] : []))).toEqual([near(2.4, 3.3 - 28 / 80), near(3.1, 3.3 - 40 / 80)]);
    const circles = [...hs.map((h) => ({ name: h.kind === "zoneEnd" ? `${h.kind} ${h.end}` : h.kind, grip: h.kind === "side" || h.kind === "rotate", at: h.at })),
      ...zoneChips(state, inset).map((c) => ({ name: `chip ${c.side}`, grip: false, at: c.at }))];
    circles.forEach((a, i) => circles.slice(i + 1).forEach((b) => {
      if (a.grip && b.grip) return;
      expect(distance(a.at, b.at) * 80, `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(16 - 1e-6);
    }));
  });

  it("a side zone's end handle near a grip pushed outside a narrow piece moves out clear of it (heights.48)", () => {
    // A bed 0.30 × 2.00 at (3, 3.9): x 2.85–3.15, y 1.9–3.9. At 80 px/m it is 24 px wide, so its left grip sits 8 px
    // outside the left edge at (2.85 − 0.1, 2.9). A left zone 0.40 deep (32 px) starting 0.95 from the back corner puts
    // its start handle 0.05 m (4 px) from the side's middle: it goes 24 px out, not 16, to stay 16 px from the grip.
    const doc = withCommands(roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } },
      { type: "setObjectSize", objectId: "bed/o0", w: 0.3, d: { standard: 2 } },
      { type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: { depth: 0.4, start: 0.95, end: 0.2 } });
    const hs = handles(selecting(doc, [BED]), doc);
    const grip = hs.find((h) => h.kind === "side" && h.side === "left")?.at;
    const start = hs.find((h) => h.kind === "zoneEnd" && h.side === "left" && h.end === "start")?.at;
    const end = hs.find((h) => h.kind === "zoneEnd" && h.side === "left" && h.end === "end")?.at;
    expect([grip, start, end]).toEqual([near(2.85 - 8 / 80, 2.9), near(2.85 - 24 / 80, 3.9 - 0.95), near(2.85 - 16 / 80, 1.9 + 0.2)]);
    expect(distance(grip ?? { x: 0, y: 0 }, start ?? { x: 0, y: 0 }) * 80).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it("hit order: grips, then zone handles, then chips", () => {
    const doc = bedTwo();
    // 8 px from both the left depth handle and its chip, nudged 1e-9 towards the handle: in floating point 1.6 − 1.5
    // is just over 0.1 (8 px) and 1.5 − 1.4 just under, so the exact midpoint would miss the handle.
    const between = hitTest(selecting(doc, [BED]), { x: 1.5 + 1e-9, y: 2.675 });
    expect(between?.handle).toEqual({ kind: "zoneDepth", placementId: "bed/p0", side: "left" });
    expect(between?.chip).toBeUndefined();
    const w = ward();
    expect(hitTest(selecting(w, [WARD], 60), { x: 3, y: 2.766667 })?.handle).toEqual({ kind: "rotate", placementId: "w/p0" });
    expect(hitTest(selecting(doc, [BED]), { x: 1.9, y: 3.45 })?.handle).toEqual({ kind: "zoneEnd", placementId: "bed/p0", side: "left", end: "start" });
  });

  it("zone handles hide during a drag, in a group, in another tool, and for a folded Murphy bed", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    shell.down({ x: 1.6, y: 2.675 });
    shell.moveTo({ x: 1.4, y: 2.675 });
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind === "moving" ? tool.state.target.kind : null).toBe("zoneDepth");
    expect(zoneHandles(shell.state, shell.doc())).toEqual([]);

    const doc = withCommands(
      bedTwo(),
      { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 } },
      { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 5, y: 3.9 } },
    );
    expect(zoneHandles(selecting(doc, [BED, { table: "placements", id: "chair/p0" }]), doc)).toEqual([]);
    expect(zoneHandles({ ...selecting(doc, [BED]), tool: idleTool("object") }, doc)).toEqual([]);
    expect(zoneHandles(selecting(doc, [{ table: "placements", id: "m/p0" }]), doc)).toEqual([]);
    expect(zoneHandles(selecting(doc, [BED]), doc)).toHaveLength(6); // the same bed, alone in the Select tool
  });
});

/** BED2 with the left zone along the whole side: y 1.9–3.9, depth handle (1.6, 2.9), start (1.9, 3.9), end (1.9, 1.9). */
const full = (...more: Command[]): Document => withCommands(bedTwo(), leftZone(0, 0), ...more);
/** FULL plus a nightstand 0.45 × 0.43 at the head: x 1.65–2.10, y 3.47–3.90. */
const night = (): Document => full(
  { type: "placeObject", linked: false, deck: null, opId: "ns", state: "s0", object: { kind: "nightstand" }, at: { x: 1.875, y: 3.9 } },
  { type: "setObjectSize", objectId: "ns/o0", w: 0.45, d: { standard: 0.43 } },
);
/** BED2 plus a 0.6 × 0.6 block at x 0.73–1.33, y 2.1–2.7, in `state`. */
const block = (state = "s0"): Document => withCommands(bedTwo(), { type: "placeObject", linked: false, deck: null, opId: "k", state, object: { kind: "block" }, at: { x: 1.03, y: 2.7 }, rotation: 0 });

const extentOf = (doc: Document, id: string, side: Side) => {
  const p = doc.placements[id];
  return p ? zoneExtent(doc, p, side) : null;
};
const zonesOf = (doc: Document, id: string) => doc.placements[id]?.zones;
const selected = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.click(BODY);
  return shell;
};

describe("zone handle drags (furnish.15, .20; AC-18, AC-19)", () => {
  it("dragging the left depth handle from 0.60 to 0.40 changes only that side in this layout; one undo restores it (AC-18)", () => {
    const shell = selected(bedTwo());
    const past = shell.state.undo.past.length;
    shell.drag({ x: 1.6, y: 2.675 }, { x: 1.77, y: 2.675 });
    const doc = shell.doc();
    expect(extentOf(doc, "bed/p0", "left")).toEqual({ depth: 0.4, start: 0.45, end: 0 });
    const zones = zonesOf(doc, "bed/p0");
    expect([zones?.leftDepth, zones?.leftStart, zones?.leftEnd]).toEqual([0.4, 0.45, 0]);
    for (const side of ["front", "back", "right"] as const) {
      expect([zones?.[`${side}Depth`], zones?.[`${side}Start`], zones?.[`${side}End`]], side).toEqual([null, null, null]);
    }
    expect(extentOf(doc, "bed/p0", "right")).toEqual({ depth: 0.6, start: 0.45, end: 0 });
    expect(Object.values(zonesOf(doc, "n/p0") ?? {}).length).toBeGreaterThan(0);
    expect(Object.values(zonesOf(doc, "n/p0") ?? {}).every((v) => v === null)).toBe(true);
    expect(extentOf(doc, "n/p0", "left")?.depth).toBe(0.6);
    expect(shell.state.undo.past.length).toBe(past + 1);
    expect(shell.state.selection).toEqual([BED]);
    shell.key("z", { meta: true });
    expect(zonesOf(shell.doc(), "bed/p0")?.leftDepth).toBeNull();
    expect(extentOf(shell.doc(), "bed/p0", "left")?.depth).toBe(0.6);
  });

  it("Ctrl drags the depth to the centimetre", () => {
    const shell = selected(bedTwo());
    shell.drag({ x: 1.6, y: 2.675 }, { x: 1.77, y: 2.675 }, { ctrl: true });
    expect(extentOf(shell.doc(), "bed/p0", "left")?.depth).toBe(0.43);
  });

  it("a second browser sees the new depth (AC-18)", () => {
    const alice = FakeRemote.open(bedTwo());
    alice.shell.click(BODY);
    alice.shell.drag({ x: 1.6, y: 2.675 }, { x: 1.77, y: 2.675 });
    const cs = alice.last();
    alice.accept(cs);
    const bob = FakeRemote.open(bedTwo());
    bob.event({ type: "changes", projectId: PROJECT.id, generation: bob.generation(), seq: 1, changeset: cs, clientId: "alice" });
    expect(extentOf(bob.shell.doc(), "bed/p0", "left")?.depth).toBe(0.4);
    expect(cs.patch.puts.map((p) => [p.table, p.entity.id])).toEqual([["placements", "bed/p0"]]);
  });

  it("the depth snaps flush to a wall face and to another piece's face", () => {
    const wall = selected(bedTwo());
    wall.drag({ x: 1.6, y: 2.675 }, { x: 0.15, y: 2.675 }); // raw 2.05, step 2.0, the wall's inner face x 0.1: 2.1
    expect(extentOf(wall.doc(), "bed/p0", "left")?.depth).toBe(2.1);
    const piece = selected(block());
    piece.drag({ x: 1.6, y: 2.675 }, { x: 1.36, y: 2.675 }); // raw 0.84, step 0.8, the block's right face: 0.87
    expect(extentOf(piece.doc(), "bed/p0", "left")?.depth).toBe(0.87);
    const elsewhere = selected(block("n/s0")); // only pieces of the active layout count
    elsewhere.drag({ x: 1.6, y: 2.675 }, { x: 1.36, y: 2.675 });
    expect(extentOf(elsewhere.doc(), "bed/p0", "left")?.depth).toBe(0.8);
    const own = selected(bedTwo()); // the bed's own left side, x 2.2, never counts: a raw 0.07 stops at 0.10
    own.drag({ x: 1.6, y: 2.675 }, { x: 2.13, y: 2.675 });
    expect(extentOf(own.doc(), "bed/p0", "left")?.depth).toBe(0.1);
  });

  it("an end handle shortens the zone along its side, and a nightstand no longer blocks it (AC-19)", () => {
    const doc = night();
    const warning = { zone: { table: "placements", id: "bed/p0", side: "left" }, against: { table: "placements", id: "ns/p0" } };
    expect(clearanceWarnings(doc, "s0")).toContainEqual(warning);
    const shell = selected(doc);
    shell.drag({ x: 1.9, y: 3.9 }, { x: 1.9, y: 3.45 }); // raw 1.55, step 1.60, the nightstand's front face: 1.57
    expect(extentOf(shell.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 0.43, end: 0 });
    expect(clearanceWarnings(shell.doc(), "s0").filter((w) => w.zone.table === "placements" && w.zone.id === "bed/p0" && w.zone.side === "left")).toEqual([]);
  });

  it("dragging the head-end handle still moves that end, one undo step (AC-02)", () => {
    const shell = selected(bedTwo());
    const past = shell.state.undo.past.length;
    shell.drag({ x: 1.9, y: 3.45 }, { x: 1.9, y: 3.2 }); // the head end, from 0.45 to 0.70 short of the head
    expect(extentOf(shell.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 0.65, end: 0 });
    expect(shell.state.undo.past.length).toBe(past + 1);
    shell.key("z", { meta: true });
    expect(extentOf(shell.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 0.45, end: 0 });
  });

  it("an end handle moves by whole steps from where it started", () => {
    const stepped = selected(bedTwo());
    stepped.drag({ x: 1.9, y: 3.45 }, { x: 1.9, y: 3.2 });
    expect(extentOf(stepped.doc(), "bed/p0", "left")?.start).toBe(0.65);
    const free = selected(bedTwo());
    free.drag({ x: 1.9, y: 3.45 }, { x: 1.9, y: 3.2 }, { ctrl: true });
    expect(extentOf(free.doc(), "bed/p0", "left")?.start).toBe(0.7);
  });

  it("a drag can't make a zone shallower or shorter than 0.10 m nor longer than its side (AC-19)", () => {
    const thin = selected(full());
    thin.drag({ x: 1.6, y: 2.9 }, { x: 2.6, y: 2.9 });
    expect(extentOf(thin.doc(), "bed/p0", "left")).toEqual({ depth: 0.1, start: 0, end: 0 });
    const short = selected(full());
    short.drag({ x: 1.9, y: 3.9 }, { x: 1.9, y: 1.0 });
    expect(extentOf(short.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 1.9, end: 0 });
    const past = selected(withCommands(bedTwo(), leftZone(0, 0.5))); // band y 2.4–3.9
    const before = past.state.undo.past.length;
    past.drag({ x: 1.9, y: 2.4 }, { x: 1.9, y: 1.0 });
    expect(extentOf(past.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 0, end: 0 });
    expect(past.state.undo.past.length).toBe(before + 1);
    expect(past.view().toast).toBeNull();
    const head = selected(bedTwo());
    head.drag({ x: 1.9, y: 3.45 }, { x: 1.9, y: 4.2 });
    expect(extentOf(head.doc(), "bed/p0", "left")).toEqual({ depth: 0.6, start: 0, end: 0 }); // the side's whole 2.0
  });

  it("a dragged clamped zone stores the clamped numbers", () => {
    const doc = withCommands(
      bedTwo(),
      { type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: { depth: 0.6, start: 1.2, end: 0.5 } },
      { type: "setObjectSize", objectId: "bed/o0", w: 1.6, d: { standard: 1.6 } },
    );
    const before = extentOf(doc, "bed/p0", "left");
    const state = selecting(doc, [BED], 400);
    const h = handles(state, doc).find((x) => x.kind === "zoneDepth" && x.side === "left");
    if (!before || !h) throw new Error("no clamped zone or no depth handle");
    expect(before.start).not.toBe(1.2);
    const { tried } = dragTry(state, doc, { kind: "zoneDepth", placementId: "bed/p0", side: "left" }, h.at, { x: h.at.x - 0.2, y: h.at.y }, 0);
    expect(tried).toEqual({ kind: "zoneExtent", side: "left", extent: { depth: 0.8, start: before.start, end: before.end } });
  });

  it("a zone drag previews the tried zone", () => {
    const shell = selected(bedTwo());
    shell.down({ x: 1.6, y: 2.675 });
    shell.moveTo({ x: 1.4, y: 2.675 });
    const ends = (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [])
      .flatMap((p) => (p.kind === "segment" && p.color === COLORS.zoneOutline ? [p.a, p.b] : []));
    expect(ends).toContainEqual(near(1.4, 1.9));
    expect(ends).toContainEqual(near(1.4, 3.45));
  });
});
