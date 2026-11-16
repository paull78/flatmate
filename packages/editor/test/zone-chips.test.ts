import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, SIDE_IDS, distance, emptyDocument, execute, rectangleRoom, unwrap, zoneExtent, type Command, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { MARGIN_MM, columnMm } from "../src/export/paper";
import { sheetPages } from "../src/export/sheet";
import type { EditorState } from "../src/state";
import { NO_MODS } from "../src/types";
import { worldToScreen } from "../src/camera";
import { chipUnderPointer, hitTest } from "../src/tools/hit-test";
import { idleTool } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { HANDLE_HIT_PX, handles } from "../src/view/handles";
import { PRESENTATION_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import type { LayerName, Primitive } from "../src/view/scene-types";
import { ZONE_CHIP_RADIUS_PX, zoneChips, zoneOutlines } from "../src/view/zone-chips";
import { bed160x200, localState, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { floorView } from "../src/view/plan-view";

// Zone outlines and chips (smart.09, smart.24; AC-06, AC-14). The bed bed/p0 spans x 2.2–3.8, y 1.9–3.9 (front at
// y 1.9); Night's copy is n/p0. Its side zones are 0.6 deep and stop 0.45 m short of the head (y 1.9–3.45), so their
// depth handles sit at (1.6, 2.675) and (4.4, 2.675). At FakeShell's 80 px/m, 24 px = 0.30 m and 16 px = 0.20 m: the
// left × is 16 px beyond its depth handle at (1.4, 2.675), the right × at (4.6, 2.675), the back + at (3, 4.2) and the
// front + at (3.2, 1.6), beside the rotation grip at (3, 1.6).
const bedTwo = (): Document => withCommands(
  roomDoc(),
  { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } },
  bed160x200("bed/o0"),
  { type: "copyState", opId: "n", from: "s0", name: "Night" },
);
const BED: EntityRef = { table: "placements", id: "bed/p0" };
const BODY = { x: 3, y: 2.9 };
const at = (p: Point) => ({ x: +p.x.toFixed(9), y: +p.y.toFixed(9) });

/** The Select tool, idle, at `zoom` with `selection` on `doc` (as handles.test.ts). */
function selecting(doc: Document, selection: EntityRef[], zoom = 80): EditorState {
  const s = localState(new FakeHost(), doc);
  return { ...s, selection, camera: { ...s.camera, zoom } };
}

function layer(shell: FakeShell, name: LayerName): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}

const outlines = (shell: FakeShell) => layer(shell, "overlays").filter((p) => p.kind === "segment" && p.color === COLORS.zoneOutline);
/** Each outlined band's corners, rounded and sorted: four segments per band, each starting at a corner. */
function bands(shell: FakeShell): string[][] {
  const starts = outlines(shell).flatMap((p) => (p.kind === "segment" ? [`${p.a.x.toFixed(9)},${p.a.y.toFixed(9)}`] : []));
  const out: string[][] = [];
  for (let i = 0; i < starts.length; i += 4) out.push(starts.slice(i, i + 4).sort());
  return out;
}
const corners = (...ps: Point[]): string[] => ps.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`).sort();

const sidesOf = (shell: FakeShell, id: string) => shell.doc().placements[id]?.sides;

describe("zone chips (smart.24, AC-14)", () => {
  it("a selected bed shows × on its left and right zones and + at its back and foot, clear of the grips (AC-14)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    expect(zoneChips(shell.state, shell.doc()).map((c) => [c.side, c.on, at(c.at)])).toEqual([
      ["front", false, { x: 3.2, y: 1.6 }],
      ["back", false, { x: 3, y: 4.2 }],
      ["left", true, { x: 1.4, y: 2.675 }],
      ["right", true, { x: 4.6, y: 2.675 }],
    ]);
    // In WebGL's kind order (polygon, segment, arc, disc), texts last, so both renderers stack them alike.
    const drawn = layer(shell, "overlays");
    const rank = ["polygon", "segment", "arc", "disc", "text"];
    const ranks = drawn.map((p) => rank.indexOf(p.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(drawn.map((p) => p.kind))).toEqual(new Set(rank)); // the arc: the rotation grip's arrow
  });

  it("the chips are drawn 6.5 px with a 9 px glyph, the \"+\" light grey, the \"×\" blue (furnish.09, AC-11)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    const drawn = layer(shell, "overlays");
    const glyphs = drawn.flatMap((p) => (p.kind === "text" ? [[p.text, p.color, p.size, at(p.at)]] : []));
    expect(glyphs).toEqual([
      ["+", COLORS.chipOff, 9, { x: 3.2, y: 1.6 }],
      ["+", COLORS.chipOff, 9, { x: 3, y: 4.2 }],
      ["×", COLORS.chipGlyph, 9, { x: 1.4, y: 2.675 }],
      ["×", COLORS.chipGlyph, 9, { x: 4.6, y: 2.675 }],
    ]);
    // Each chip: a ring disc, then a fill disc ("×" all blue; "+" white inside a light grey ring). The grips' and
    // zone handles' discs are left out.
    const centres = zoneChips(shell.state, shell.doc()).map((c) => c.at);
    const onChip = (p: Primitive): boolean => p.kind === "disc" && centres.some((c) => distance(p.center, c) < 1e-9);
    const discs = drawn.flatMap((p) => (p.kind === "disc" && onChip(p) ? [[at(p.center), p.radius, p.color]] : []));
    expect(discs).toEqual([
      [{ x: 3.2, y: 1.6 }, { px: 6.5 }, COLORS.chipOff],
      [{ x: 3.2, y: 1.6 }, { px: 5 }, COLORS.handle],
      [{ x: 3, y: 4.2 }, { px: 6.5 }, COLORS.chipOff],
      [{ x: 3, y: 4.2 }, { px: 5 }, COLORS.handle],
      [{ x: 1.4, y: 2.675 }, { px: 6.5 }, COLORS.chip],
      [{ x: 1.4, y: 2.675 }, { px: 5 }, COLORS.chip],
      [{ x: 4.6, y: 2.675 }, { px: 6.5 }, COLORS.chip],
      [{ x: 4.6, y: 2.675 }, { px: 5 }, COLORS.chip],
    ]);
    // Drawn about a grip's size, hit as a grip is (AC-11).
    const pxs = drawn.flatMap((p) => (p.kind === "disc" && onChip(p) && "px" in p.radius ? [p.radius.px] : []));
    expect(pxs).toHaveLength(8);
    for (const px of pxs) expect(px).toBeLessThanOrEqual(6.5);
    expect(HANDLE_HIT_PX).toBe(8);
    expect(ZONE_CHIP_RADIUS_PX).toBeLessThan(HANDLE_HIT_PX);
  });

  it("a chip still toggles when clicked outside its drawn disc but inside 8 px (AC-11)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    shell.click({ x: 1.4 - 0.09, y: 2.675 }); // 7.2 px from the left "×", outside its 6.5 px disc
    expect(sidesOf(shell, "bed/p0")).toEqual({ front: false, back: false, left: false, right: true });
  });

  it("the \"+\" chip darkens only while the pointer is over it (furnish.09, AC-11)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    /** Each chip's ring and glyph colour, in SIDE_IDS order. */
    const looks = () => {
      const drawn = layer(shell, "overlays");
      return zoneChips(shell.state, shell.doc()).map((c) => [
        drawn.find((p) => p.kind === "disc" && distance(p.center, c.at) < 1e-9 && "px" in p.radius && p.radius.px === 6.5)?.color,
        drawn.find((p) => p.kind === "text" && distance(p.at, c.at) < 1e-9)?.color,
      ]);
    };
    const quiet = [[COLORS.chipOff, COLORS.chipOff], [COLORS.chipOff, COLORS.chipOff], [COLORS.chip, COLORS.chipGlyph], [COLORS.chip, COLORS.chipGlyph]];
    expect(looks()).toEqual(quiet);
    shell.moveTo({ x: 3.2 + 0.09, y: 1.6 }); // 7.2 px from the front "+"
    expect(looks()).toEqual([[COLORS.chipOffHover, COLORS.chipOffHover], ...quiet.slice(1)]);
    shell.moveTo({ x: 3.2 + 0.11, y: 1.6 }); // 8.8 px: out of reach
    expect(looks()).toEqual(quiet);
    shell.moveTo({ x: 1.4, y: 2.675 }); // over the left "×": it looks the same
    expect(looks()).toEqual(quiet);
    shell.moveTo({ x: 3.2, y: 1.6 });
    expect(looks()[0]).toEqual([COLORS.chipOffHover, COLORS.chipOffHover]);
    shell.send({ type: "pointerLeave" });
    expect(looks()).toEqual(quiet);
  });

  it("chipUnderPointer matches what a press would hit", () => {
    const doc = bedTwo();
    const pointing = (world: Point, state = selecting(doc, [BED])): EditorState =>
      ({ ...state, pointer: { screen: worldToScreen(state.camera, world), world, mods: NO_MODS } });
    expect(chipUnderPointer(pointing({ x: 3.2, y: 1.6 }), doc)).toEqual({ placementId: "bed/p0", side: "front" });
    expect(chipUnderPointer(pointing({ x: 3, y: 1.6 }), doc)).toBeNull(); // over the rotation grip, 16 px from the chip
    // Halfway between the rotation grip (3, 1.525) and the front + (3.25, 1.525) at 64 px/m, both exactly 8 px away
    // (binary fractions, no rounding): the grip wins, for the hover as for the press.
    const zoomed = selecting(doc, [BED], 64);
    const mid = { x: 3.125, y: 1.525 };
    expect(handles(zoomed, doc).find((h) => h.kind === "rotate")?.at).toEqual({ x: 3, y: 1.525 });
    expect(zoneChips(zoomed, doc)[0]?.at).toEqual({ x: 3.25, y: 1.525 });
    expect(hitTest(pointing(mid, zoomed), mid)?.handle?.kind).toBe("rotate");
    expect(chipUnderPointer(pointing(mid, zoomed), doc)).toBeNull();
    expect(chipUnderPointer(pointing({ x: 3.2, y: 1.6 }, { ...selecting(doc, [BED]), tool: idleTool("object") }), doc)).toBeNull();
    expect(chipUnderPointer({ ...selecting(doc, [BED]), pointer: null }, doc)).toBeNull();
  });

  it("clicking the left × turns left off in this layout only; one undo turns it back on (AC-14)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    const past = shell.state.undo.past.length;
    shell.click({ x: 1.4, y: 2.675 });
    expect(sidesOf(shell, "bed/p0")).toEqual({ front: false, back: false, left: false, right: true });
    expect(sidesOf(shell, "n/p0")).toEqual({ front: false, back: false, left: true, right: true });
    expect(shell.state.selection).toEqual([BED]);
    expect(shell.state.undo.past).toHaveLength(past + 1);
    shell.key("z", { meta: true });
    expect(sidesOf(shell, "bed/p0")?.left).toBe(true);
  });

  it("clicking the + at the foot turns the front zone on (AC-14)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    expect(bands(shell)).not.toContainEqual(corners({ x: 2.2, y: 1.3 }, { x: 3.8, y: 1.3 }, { x: 3.8, y: 1.9 }, { x: 2.2, y: 1.9 }));
    shell.click({ x: 3.2, y: 1.6 });
    expect(sidesOf(shell, "bed/p0")?.front).toBe(true);
    expect(bands(shell)).toContainEqual(corners({ x: 2.2, y: 1.3 }, { x: 3.8, y: 1.3 }, { x: 3.8, y: 1.9 }, { x: 2.2, y: 1.9 }));
  });

  it("a drag on the left resize grip still resizes (AC-14)", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click(BODY);
    shell.drag({ x: 2.2, y: 2.9 }, { x: 2.0, y: 2.9 }, { ctrl: true }); // Ctrl: no snapping
    expect(shell.doc().objects["bed/o0"]?.w.standard).toBeCloseTo(1.8, 9);
    expect(sidesOf(shell, "bed/p0")).toEqual({ front: false, back: false, left: true, right: true });
  });

  it("grips win over chips where their hit circles overlap; chips win over the floor", () => {
    const doc = bedTwo();
    // At 20 px/m the left zone is 12 px deep, so it has no handles: (1.95, 2.9) is 5 px from the left grip (2.2, 2.9).
    expect(hitTest(selecting(doc, [BED], 20), { x: 1.95, y: 2.9 })?.handle).toEqual({ kind: "resize", placementId: "bed/p0", side: "left" });
    expect(hitTest(selecting(doc, [BED]), { x: 1.4, y: 2.675 })).toEqual({ ref: BED, handle: null, chip: { placementId: "bed/p0", side: "left" } });
    // The chip's hit radius is HANDLE_HIT_PX (8 px = 0.1 m at 80 px/m): 7.2 px hits it, 8.8 px falls through.
    expect(hitTest(selecting(doc, [BED]), { x: 1.4 - 0.09, y: 2.675 })?.chip).toEqual({ placementId: "bed/p0", side: "left" });
    expect(hitTest(selecting(doc, [BED]), { x: 1.4 - 0.11, y: 2.675 })?.chip).toBeUndefined();
    const shell = FakeShell.withDocument(doc);
    shell.click(BODY);
    const before = shell.doc();
    const past = shell.state.undo.past.length;
    shell.drag({ x: 1.4, y: 2.675 }, { x: 0.8, y: 2.675 });
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(past);
    expect(shell.state.selection).toEqual([BED]);
  });

  it("no two shown hit circles overlap: grips, zone handles and chips, for every kind with a zone, at any rotation, size, zoom and zone (fuzz)", () => {
    let room = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 20, 20)) room = unwrap(execute(room, cmd)).doc;
    const X: EntityRef = { table: "placements", id: "x/p0" };
    type Circle = { tag: "grip" | "zone" | "chip"; name: string; at: Point };
    /** Every shown hit circle of the selected x/p0: grips, zone handles and chips. */
    const circles = (state: EditorState, doc: Document): Circle[] => [
      ...handles(state, doc).map((h): Circle => {
        switch (h.kind) {
          case "joint": return { tag: "grip", name: "joint", at: h.at };
          case "side": return { tag: "grip", name: `side ${h.side}`, at: h.at };
          case "rotate": return { tag: "grip", name: "rotate", at: h.at };
          case "armGrip": return { tag: "grip", name: `armGrip ${h.arm}`, at: h.at };
          case "zoneDepth": return { tag: "zone", name: `zoneDepth ${h.side}`, at: h.at };
          case "zoneEnd": return { tag: "zone", name: `zoneEnd ${h.side} ${h.end}`, at: h.at };
          case "deckSide": return { tag: "grip", name: `deckSide ${h.side}`, at: h.at };
          case "holeSide": return { tag: "grip", name: `holeSide ${h.side}`, at: h.at };
          case "areaSide": return { tag: "grip", name: `areaSide ${h.side}`, at: h.at };
          case "sectionEnd": return { tag: "grip", name: `sectionEnd ${h.end}`, at: h.at };
          case "sectionFar": return { tag: "grip", name: "sectionFar", at: h.at };
          default: return assertNever(h);
        }
      }),
      ...zoneChips(state, doc).map((c): Circle => ({ tag: "chip", name: `chip ${c.side}`, at: c.at })),
    ];
    /** The side a zone handle or chip belongs to; null for a grip. */
    const sideOfCircle = (c: Circle): string | null => (c.tag === "grip" ? null : (c.name.split(" ")[1] ?? null));
    // `overlapping`: an `L` front zone deeper than its quarter is wide reaches past the footprint's right side, over a
    // right zone: their circles may meet at low zoom (the nearer wins; zooming in parts them).
    const apart = (cs: Circle[], zoom: number, label: string, overlapping = false): void => {
      cs.forEach((a, i) => cs.slice(i + 1).forEach((b) => {
        if (a.tag === "grip" && b.tag === "grip") return;
        if (overlapping && new Set([sideOfCircle(a), sideOfCircle(b)]).size === 2 && [a, b].every((c) => ["front", "right"].includes(sideOfCircle(c) ?? ""))) return;
        expect(distance(a.at, b.at) * zoom, `${label}: ${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(16 - 1e-6);
      }));
    };
    const zoneCount = (cs: Circle[]): number => cs.filter((c) => c.tag === "zone").length;

    // Pinned: a default bed (1.70 × 2.10) at (10, 10), front edge at y 7.9.
    const bed = (...more: Command[]): Document => withCommands(room, { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: "bed" }, at: { x: 10, y: 10 } }, ...more);
    const front = bed({ type: "setZoneSides", placementId: "x/p0", sides: { front: true, back: false, left: true, right: true } });
    const at40 = selecting(front, [X], 40); // 24 px deep zones: no handles
    expect(zoneCount(circles(at40, front))).toBe(0);
    expect(zoneChips(at40, front).find((c) => c.side === "front")?.at).toEqual({ x: 10, y: expect.closeTo(7.9 - 56 / 40, 9) });
    expect(distance(zoneChips(at40, front).find((c) => c.side === "front")?.at ?? { x: 0, y: 0 }, handles(at40, front).find((h) => h.kind === "rotate")?.at ?? { x: 0, y: 0 }) * 40).toBeCloseTo(32, 9);
    const left = bed({ type: "setZoneSides", placementId: "x/p0", sides: { front: false, back: false, left: true, right: false } });
    expect(zoneCount(circles(selecting(left, [X], 53), left))).toBe(0); // 31.8 px deep
    expect(circles(selecting(left, [X], 54), left).filter((c) => c.tag === "zone").map((c) => c.name)).toEqual(["zoneDepth left", "zoneEnd left start", "zoneEnd left end"]);

    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647; // Park–Miller, reproducible
    let checked = 0;
    let shown = 0;
    let ells = 0;
    for (const kind of OBJECT_KINDS) {
      // An `L` keeps its arms: sides from the deeper arm + 0.10, 0.70 or the sofa's 1.00 (catalog.12); its front zone's two strips are trimmed each from its far
      // end, so `start` runs along d − t1 and `end` along w − t2 (catalog.13); it has two more grips, its arm grips.
      const ell = kind.arms;
      const lo = ell ? Math.max(ell.back, ell.left) + 0.1 : 0;
      for (const config of kind.configs.filter((c) => c.zone !== null)) {
        for (let rotation = 0; rotation < 360; rotation += 7) {
          for (const on of [true, false]) {
            // Even rotations keep the defaults at 80 px/m; odd ones take a random size (0.1–3 m) and zoom (5–300 px/m).
            const fuzzed = rotation % 2 === 1;
            const zoom = fuzzed ? 5 + random() * 295 : 80;
            const fit = (v: number): number => (ell ? lo + (v - 0.1) * ((3 - lo) / 2.9) : v);
            const [w, d0] = fuzzed ? [fit(0.1 + random() * 2.9), fit(0.1 + random() * 2.9)] : [null, null];
            // A winder stays deeper than wide by 0.05 at least (I19, steps.09); the draws stay as they were.
            const d = kind.stair?.shape === "winder" && w !== null && d0 !== null ? Math.max(d0, w + 0.06) : d0;
            const place: Command = { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: kind.id }, at: { x: 10, y: 10 }, rotation, config: config.id };
            // With `on`, each side may store a zone, set on the default size; the resize after it clamps when read.
            const zones: Command[] = on ? SIDE_IDS.flatMap((side): Command[] => {
              if (random() < 0.5) return [];
              const l0 = side === "front" || side === "back" ? config.w : config.d;
              const depth = 0.1 + random() * 1.4;
              if (ell && side === "front") {
                const start = random() * (config.d - ell.back - 0.1);
                const end = random() * (config.w - ell.left - 0.1);
                return [{ type: "setZoneExtent", placementId: "x/p0", side, extent: { depth, start, end } }];
              }
              const start = random() * (l0 - 0.1);
              const end = random() * (l0 - 0.1 - start);
              return [{ type: "setZoneExtent", placementId: "x/p0", side, extent: { depth, start, end } }];
            }) : [];
            const size: Command[] = w !== null && d !== null
              ? [{ type: "setObjectSize", objectId: "x/o0", w, d: Object.fromEntries(kind.configs.map((c) => [c.id, d])) }] : [];
            const doc = withCommands(room, place, ...zones, ...size, { type: "setZoneSides", placementId: "x/p0", sides: { front: on, back: on, left: on, right: on } });
            const state = selecting(doc, [X], zoom);
            const label = `${kind.id} ${config.id} ${rotation}° ${w ?? "default"}×${d ?? "default"} at ${zoom} px/m`;
            const cs = circles(state, doc);
            expect(cs.filter((c) => c.tag === "grip"), label).toHaveLength(ell ? 7 : 5);
            expect(cs.filter((c) => c.tag === "chip"), label).toHaveLength(4);
            // The oracle: three handles per active side whose resolved band is at least 32 px deep and long.
            const p = doc.placements["x/p0"];
            const object = p ? doc.objects[p.object] : undefined;
            const pw = p ? object?.w[p.config] ?? 0 : 0;
            const pd = p ? object?.d[p.config] ?? 0 : 0;
            const expected = SIDE_IDS.reduce((n, side) => {
              const e = p ? zoneExtent(doc, p, side) : null;
              if (ell && side === "front") return n + (e ? ellHandleCount(pw, pd, ell, e, zoom) : 0);
              const length = side === "front" || side === "back" ? pw : pd;
              return n + (e !== null && e.depth * zoom >= 32 - 1e-6 && (length - e.start - e.end) * zoom >= 32 - 1e-6 ? 3 : 0);
            }, 0);
            expect(zoneCount(cs), label).toBe(expected);
            shown += expected / 3;
            if (ell) ells += expected;
            const front = p ? zoneExtent(doc, p, "front") : null;
            apart(cs, zoom, label, ell !== null && front !== null && p?.sides.right === true && front.depth > pw - ell.left);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(500);
    expect(ells).toBeGreaterThan(50); // `L` front handles shown and kept apart (catalog.27, .38)
  }, 30_000); // a long fuzz: the default 5 s fails under a parallel pnpm check (cleanup M3 review)

  /**
   * The oracle for an `L` front zone's handles (catalog.13), none under 32 px deep: one per line of a strip, its outer
   * line or its far end, whose part not inside the other strip is at least 32 px long on screen; an end handle only on
   * a strip at least 32 px long. A strip runs from the inner corner, `left` d − t1 − start, `back` w − t2 − end long.
   */
  function ellHandleCount(w: number, d: number, arms: { back: number; left: number }, e: { depth: number; start: number; end: number }, zoom: number): number {
    const [z, left, back] = [e.depth, d - arms.back - e.start, w - arms.left - e.end];
    if (z * zoom < 32 - 1e-6) return 0;
    const lines = [
      back - (left > z ? Math.min(back, z) : 0), // the back strip's outer line, less what lies inside the left strip
      left - (back > z ? Math.min(left, z) : 0),
      back * zoom >= 32 - 1e-6 ? z - (back < z ? Math.min(z, left) : 0) : 0, // the back strip's far end
      left * zoom >= 32 - 1e-6 ? z - (left < z ? Math.min(z, back) : 0) : 0,
    ];
    return lines.filter((l) => l * zoom >= 32 - 1e-6).length;
  }

  it("no chips for a chair, a folded murphy bed, a group, another tool, or during a drag", () => {
    const doc = withCommands(
      bedTwo(),
      { type: "placeObject", deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 } },
      { type: "placeObject", deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 5, y: 3.9 } },
    );
    expect(zoneChips(selecting(doc, [{ table: "placements", id: "chair/p0" }]), doc)).toEqual([]);
    expect(zoneChips(selecting(doc, [{ table: "placements", id: "m/p0" }]), doc)).toEqual([]);
    expect(zoneChips(selecting(doc, [BED, { table: "placements", id: "chair/p0" }]), doc)).toEqual([]);
    expect(zoneChips({ ...selecting(doc, [BED]), tool: idleTool("object") }, doc)).toEqual([]);
    expect(zoneChips(selecting(doc, [BED]), doc)).toHaveLength(4); // the same bed, selected alone in the Select tool
    const shell = FakeShell.withDocument(doc);
    shell.click(BODY);
    shell.down(BODY);
    shell.moveTo({ x: 3.2, y: 2.9 });
    expect(shell.state.tool.name === "select" && shell.state.tool.state.kind).toBe("moving");
    expect(zoneChips(shell.state, shell.doc())).toEqual([]);
  });
});

describe("zoneOutlines", () => {
  it("draws only the placements of the given layout", () => {
    const doc = bedTwo();
    expect(zoneOutlines(doc, ["bed/p0"], "s0")).toHaveLength(8); // left and right bands, four segments each
    expect(zoneOutlines(doc, ["n/p0"], "s0")).toEqual([]);
    expect(zoneOutlines(doc, ["bed/p0"], null)).toEqual([]);
  });
});

describe("zone outlines (smart.09, AC-06)", () => {
  const deskDoc = (): Document => withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 3.9 } });

  it("a selected desk shows its front zone as a dashed outline; nothing when deselected; amber with a block in it; no zone on paper (AC-06)", () => {
    const shell = FakeShell.withDocument(deskDoc());
    shell.click({ x: 3, y: 3.6 });
    const lines = outlines(shell);
    expect(lines).toHaveLength(4);
    for (const s of lines) expect(s).toMatchObject({ dash: [6, 4], width: { px: 1.5 } });
    expect(bands(shell)).toEqual([corners({ x: 2.65, y: 2.5 }, { x: 3.35, y: 2.5 }, { x: 3.35, y: 3.3 }, { x: 2.65, y: 3.3 })]); // 0.70 m, centred
    shell.key("Escape");
    expect(outlines(shell)).toEqual([]);
    expect(layer(shell, "warnings")).toEqual([]);

    const blocked = withCommands(deskDoc(), { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 3, y: 3.2 } });
    const amber = FakeShell.withDocument(blocked);
    const warnings = layer(amber, "warnings").filter((p) => p.kind === "polygon");
    expect(warnings).toHaveLength(1);
    const ys = warnings.flatMap((p) => (p.kind === "polygon" ? p.points.map((q) => q.y) : []));
    expect(Math.min(...ys)).toBeCloseTo(2.5, 9);
    expect(Math.max(...ys)).toBeCloseTo(3.3, 9);

    const host = new FakeHost();
    host.today = () => "2026-10-15";
    const picture = pictureLayers(planPicture(blocked, floorView(blocked, "s0"), PRESENTATION_STYLE, 20, true));
    const page = sheetPages(blocked, { projectName: "Flat", paper: "A4", scale: "fit", host, finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    const columnX = page.widthMm - MARGIN_MM - columnMm("A4");
    for (const ps of [picture, page.primitives]) {
      expect(ps.length).toBeGreaterThan(0);
      expect(ps.filter((p) => p.color === COLORS.warning || p.color === COLORS.warningLine || p.color === COLORS.zoneOutline)).toEqual([]);
    }
    expect(picture.filter((p) => p.kind === "segment" && p.dash !== undefined)).toEqual([]);
    // In the plan area: strictly inside the margin and left of the title column.
    const inPlan = (q: Point): boolean => q.x > MARGIN_MM && q.x < columnX && q.y > MARGIN_MM && q.y < page.heightMm - MARGIN_MM;
    expect(page.primitives.filter((p) => p.kind === "segment" && p.dash !== undefined && inPlan({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }))).toEqual([]);
  });
});
