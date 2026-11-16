import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERF } from "./perf-switch";
import { execute, SURROUNDINGS_VALUES, unwrap, type Document, type Surroundings } from "@fm/domain";
import { camera3d, DEFAULT_ANGLES, lookScene3d, shellBounds, STYLE_3D, SURROUNDINGS, type Angles3d, type LookScene3d } from "@fm/editor";
import { LAYOUT3D, packView3d, raster3d, triangles3d, VIEW3D_UNIFORM, view3dUniform } from "@fm/render";
import { look3dPixels, look3dPng } from "../src/look3d-png";
import { encodePng } from "../src/png";
import { pngPixels } from "./pictures";
import { decodePng } from "./png.test";
import { drawing, FIXTURE_DIR, fixtureFaces, fixturePixels, index, yawOf } from "./fixture-pictures";

// Look's 3D picture on raster3d (real3d.02, .11, .13): held to the painter's frozen pictures (AC-16), timed (AC-12),
// and within the reply's PNG budget (AC-15).

const LOOK_PNG_BUDGET_BYTES = 999_285; // look.test.ts: the worst case that showed inline in Claude Code
const AGREE_FACES = 0.995; // AC-16 (real3d.17): away from outlines
const AGREE_WHOLE = 0.97; // AC-16: the whole picture, outlines included
const MAX_MASK = 0.1; // the outline mask's share of the picture
const TOLERANCE = 8; // per colour channel
/** How many pixels beside a probe to look as well. */
const SIDE_PROBE = 6;

/**
 * The outline mask (real3d.17): pixels where raster3d's outlines change the picture, and a one-pixel border, found by
 * drawing once more with the outlines in another colour.
 */
function outlineMask(mine: Uint8Array, recoloured: Uint8Array, size: number): Uint8Array {
  const edge = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) if ([0, 1, 2].some((c) => mine[4 * k + c] !== recoloured[4 * k + c])) edge[k] = 1;
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!edge[y * size + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < size && y + dy < size) mask[(y + dy) * size + x + dx] = 1;
    }
  }
  return mask;
}

/** The shares of pixels within TOLERANCE on every channel, whole and away from `mask`, and a diff picture (red where they differ). */
function agreement(a: Uint8Array, b: Uint8Array, mask: Uint8Array): { whole: number; faces: number; masked: number; diff: Uint8Array } {
  const diff = new Uint8Array(a.length);
  let same = 0;
  let sameFaces = 0;
  let masked = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ok = [0, 1, 2].every((k) => Math.abs((a[i + k] ?? 0) - (b[i + k] ?? 0)) <= TOLERANCE);
    const m = mask[i / 4] === 1;
    if (ok) same++;
    if (m) masked++;
    else if (ok) sameFaces++;
    diff.set(ok ? [a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0, 60] : m ? [255, 160, 160, 255] : [255, 0, 0, 255], i);
  }
  const n = a.length / 4;
  return { whole: same / n, faces: sameFaces / (n - masked), masked: masked / n, diff };
}

describe("look in 3D on raster3d", () => {
  it("matches every frozen painter picture within 8 per channel: 99.5 % away from outlines, 97 % whole (AC-16, real3d.17)", () => {
    const failures: string[] = [];
    let out = "";
    for (const p of index.pictures) {
      const faces = fixtureFaces(p);
      const mine = fixturePixels(p, faces); // the camera the picture was frozen with
      const mask = outlineMask(mine.pixels, fixturePixels(p, faces, { ...STYLE_3D, edge: "#ff00ff" }).pixels, mine.width);
      const frozen = pngPixels(readFileSync(new URL(p.file, FIXTURE_DIR)));
      const { whole, faces: share, masked, diff } = agreement(mine.pixels, frozen.pixels, mask);
      if (share < AGREE_FACES || whole < AGREE_WHOLE || masked > MAX_MASK) {
        out ||= mkdtempSync(join(tmpdir(), "fm-look3d-"));
        writeFileSync(join(out, `diff-${p.file}`), encodePng(mine.width, mine.height, diff));
        writeFileSync(join(out, `mine-${p.file}`), encodePng(mine.width, mine.height, mine.pixels));
        failures.push(`${p.file}: ${(share * 100).toFixed(2)} % away from outlines, ${(whole * 100).toFixed(2)} % whole, mask ${(masked * 100).toFixed(1)} %`);
      }
    }
    expect(failures, `diffs in ${out}`).toEqual([]);
  }, 60_000); // 24 pictures, each drawn twice at 2200² samples: about 16 s

  it("lookScene3d gives each frozen picture's faces and today's background, bounds and colours (AC-01)", () => {
    for (const p of index.pictures) {
      const doc = drawing(p.drawing);
      const scene = lookScene3d(doc, p.state, { yaw: yawOf(p.turn), tilt: 35 });
      if ("refused" in scene) throw new Error(scene.refused);
      expect(scene.faces, p.file).toEqual(fixtureFaces(p));
      expect(scene.bounds, p.file).toEqual(shellBounds(doc));
      expect(scene.bounds, p.file).toEqual(p.bounds);
      expect([scene.background, scene.edge]).toEqual([STYLE_3D.background, STYLE_3D.edge]);
    }
    expect(STYLE_3D.background).toBe("#ffffff");
  });

  it("every kind on the kinds sheet is drawn: its own colours at the centre of its largest top (painter.test's parts check, on raster3d)", () => {
    const sheet = drawing("kinds");
    const bounds = shellBounds(sheet);
    if (!bounds) throw new Error("no walls");
    const scene = lookScene3d(sheet, "s0", DEFAULT_ANGLES);
    if ("refused" in scene) throw new Error(scene.refused);
    const img = look3dPixels(scene);
    const cam = camera3d(bounds, DEFAULT_ANGLES);
    const wrong: string[] = [];
    let probed = 0;
    for (const id of Object.keys(sheet.placements)) {
      const owner = `piece/${id}`;
      const tops = scene.faces.filter((f) => f.owner === owner && f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9));
      const area = (f: (typeof tops)[number]): number => Math.abs(f.points.reduce((a, p, k) => { const q = f.points[(k + 1) % f.points.length] ?? p; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
      const top = tops.reduce<(typeof tops)[number] | undefined>((best, f) => (best === undefined || area(f) > area(best) ? f : best), undefined);
      if (!top || top.points.length < 3) continue;
      const c = { x: top.points.reduce((s, p) => s + p.x, 0) / top.points.length, y: top.points.reduce((s, p) => s + p.y, 0) / top.points.length, z: top.points[0]?.z ?? 0 };
      const q = cam.project(c);
      const px = Math.floor(((q.x + 1) / 2) * img.width);
      const py = Math.floor(((1 - q.y) / 2) * img.height);
      const own = new Set(scene.faces.filter((f) => f.owner === owner).map((f) => f.color));
      const nearAt = (x: number, y: number, hex: string): boolean => [1, 3, 5].every((k, c) => Math.abs((img.pixels[4 * (y * img.width + x) + c] ?? 0) - parseInt(hex.slice(k, k + 2), 16)) <= TOLERANCE);
      probed++;
      // Beside the centre too: a flight's thin handrail, its own or a neighbour's, may pass in front of it, all edge and antialiasing.
      const seen = [0, -SIDE_PROBE, SIDE_PROBE].some((dx) => [0, -SIDE_PROBE, SIDE_PROBE].some((dy) => [...own, scene.edge].some((hex) => nearAt(px + dx, py + dy, hex))));
      if (!seen) wrong.push(`${sheet.placements[id]?.object ?? id}: none of its colours at ${px},${py}`);
    }
    expect(probed).toBeGreaterThan(40);
    expect(wrong).toEqual([]);
  });

  it("culling by winding takes no visible face away: every drawing at every turn draws as with every triangle two-sided (AC-14)", () => {
    const stride = LAYOUT3D.face3d.strideFloats;
    const failures: string[] = [];
    for (const p of index.pictures) {
      const tris = triangles3d(fixtureFaces(p), STYLE_3D.edge);
      // Each triangle again, wound the other way: raster3d then culls nothing, as a renderer without culling would.
      const both = new Float32Array(tris.fill.length * 2);
      both.set(tris.fill);
      for (let t = 0; t < tris.fill.length; t += 3 * stride) {
        for (const [k, from] of [0, 2, 1].entries()) both.set(tris.fill.subarray(t + from * stride, t + (from + 1) * stride), tris.fill.length + t + k * stride);
      }
      const view = packView3d(p.matrix, p.bounds);
      const culled = raster3d(tris, view, 400, STYLE_3D.background).pixels;
      const twoSided = raster3d({ fill: both, edges: tris.edges }, view, 400, STYLE_3D.background).pixels;
      let differ = 0;
      for (let i = 0; i < culled.length; i += 4) if ([0, 1, 2].some((c) => Math.abs((culled[i + c] ?? 0) - (twoSided[i + c] ?? 0)) > TOLERANCE)) differ++;
      if (differ / (400 * 400) > 0.002) failures.push(`${p.file}: ${((100 * differ) / (400 * 400)).toFixed(2)} % differ`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  const studio = drawing("studio");
  const studioState = index.pictures.find((p) => p.drawing === "studio")?.state ?? "";

  it("the platform's bare top shows the deck colour from above (studio AC-05)", () => {
    const above: Angles3d = { yaw: 225, tilt: 90 };
    const scene = lookScene3d(studio, studioState, above);
    if ("refused" in scene) throw new Error(scene.refused);
    const img = look3dPixels(scene);
    const q = camera3d(scene.bounds, above).project({ x: 2.85, y: 1.85, z: 0.45 }); // west of where the new seed's sofa stands
    const i = 4 * (Math.floor(((1 - q.y) / 2) * img.height) * img.width + Math.floor(((q.x + 1) / 2) * img.width));
    const want = [1, 3, 5].map((k) => parseInt(STYLE_3D.deck.top.slice(k, k + 2), 16));
    expect([0, 1, 2].map((c) => Math.abs((img.pixels[i + c] ?? 0) - (want[c] ?? 0)))).toSatisfy((d: number[]) => d.every((v) => v <= TOLERANCE));
  });


  it("the studio's PNG is within the reply budget and decodes to raster3d's exact pixels (AC-15)", () => {
    const scene = lookScene3d(studio, studioState, DEFAULT_ANGLES);
    if ("refused" in scene) throw new Error(scene.refused);
    const png = look3dPng(scene);
    expect(png.length).toBeLessThan(LOOK_PNG_BUDGET_BYTES);
    const pixels = look3dPixels(scene).pixels;
    expect(decodePng(png).pixels.every((v, i) => v === pixels[i])).toBe(true);
    expect(shellBounds(studio)).toEqual(scene.bounds);
  });

});

describe("look in 3D with surroundings (surroundings.03, .13, .14)", () => {
  const studio = drawing("studio");
  const studioState = index.pictures.find((p) => p.drawing === "studio")?.state ?? "";
  const surrounded = (value: Surroundings) => (doc: Document): Document => unwrap(execute(doc, { type: "setProjectField", key: "surroundings", value })).doc;
  const DRAWN = SURROUNDINGS_VALUES.map((s) => s.value); // every surroundings, each with its row
  /** Each plate's least share of look's pixels in its exact colour at tilts 10 to 90 (at 10, Outside 1.9 %, Interior 1.0 %, Grid 1.8 %, On wheels 5.5 %). */
  const PLATE_SHARE: Record<Surroundings, number> = { outside: 0.01, interior: 0.005, grid: 0.01, wheels: 0.02 };
  const scene3d = (doc: Document, angles: Angles3d): LookScene3d => {
    const scene = lookScene3d(doc, studioState, angles);
    if ("refused" in scene) throw new Error(scene.refused);
    return scene;
  };
  const YAWS = Array.from({ length: 24 }, (_, i) => 15 * i);
  const TILTS = Array.from({ length: 17 }, (_, i) => 10 + 5 * i);

  it.each(DRAWN)("%s: every line and ring vertex is inside packView3d's depth range at yaw steps of 15° and tilt steps of 5° (AC-02)", (value) => {
    const depth = (VIEW3D_UNIFORM.find((f) => f.name === "depth")?.offset ?? NaN) / 4;
    for (const doc of [studio, drawing("random1"), drawing("kinds")]) {
      const scene = scene3d(surrounded(value)(doc), DEFAULT_ANGLES);
      const ground = scene.faces.filter((f) => f.owner.startsWith("ground/")).flatMap((f) => [...f.points, ...f.holes.flat(), ...(f.lines ?? []).flatMap((l) => [l.a, l.b])]);
      expect(ground.length).toBeGreaterThan(1000);
      for (const yaw of YAWS) {
        for (const tilt of TILTS) {
          const view = view3dUniform(scene.bounds, { yaw, tilt });
          const [mid = NaN, half = NaN] = view.slice(depth, depth + 2);
          const cam = camera3d(scene.bounds, { yaw, tilt });
          const zs = ground.map((p) => cam.project(p).z);
          const label = `yaw ${yaw}, tilt ${tilt}: ${mid - half} to ${mid + half}`;
          expect(Math.min(...zs), `near, ${label}`).toBeGreaterThan(mid - half);
          expect(Math.max(...zs), `far, ${label}`).toBeLessThan(mid + half);
        }
      }
    }
  });

  it.each(DRAWN)("%s: look's PNG at tilts 10, 35, 70, 90: no pixel on the square's border differs from the background, within the reply budget (AC-02)", (value) => {
    const doc = surrounded(value)(studio);
    for (const yaw of [200, 225, 300]) { // at 200 a corner of the studio's box (its diagonal at 200.6°) faces the camera
      for (const tilt of [10, 35, 70, 90]) {
        const scene = scene3d(doc, { yaw, tilt });
        const png = look3dPng(scene); // look's own reply, read back
        expect(png.length).toBeLessThan(LOOK_PNG_BUDGET_BYTES);
        const { width, height, pixels } = decodePng(png);
        const bg = [1, 3, 5].map((k) => parseInt(scene.background.slice(k, k + 2), 16));
        const off: string[] = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (x > 0 && y > 0 && x < width - 1 && y < height - 1) continue;
            const i = 4 * (y * width + x);
            if ([0, 1, 2].some((c) => pixels[i + c] !== bg[c])) off.push(`${x},${y}`);
          }
        }
        expect(off.slice(0, 5), `yaw ${yaw}, tilt ${tilt}: ${off.length} border pixels off the background`).toEqual([]);
      }
    }
  }, 30_000);

  it.each(DRAWN)("%s: look's PNG at tilts 10, 35, 70, 90 shows the plate round the house, and None shows none of its colour", (value) => {
    // Catches a plate lost between the scene and the raster, such as quads wound the wrong way and culled by raster3d.
    // Its exact colour: the studio's own greys come within 8 of Interior's slab (1.6 % of None's pixels at tilt 10).
    const plate = SURROUNDINGS[value].ground;
    const want = [1, 3, 5].map((k) => parseInt(plate.slice(k, k + 2), 16));
    const share = (scene: LookScene3d): number => {
      const { pixels } = look3dPixels(scene);
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].every((c) => pixels[i + c] === want[c])) n++;
      return n / (pixels.length / 4);
    };
    const least = PLATE_SHARE[value];
    for (const tilt of [10, 35, 70, 90]) {
      expect(share(scene3d(studio, { yaw: 225, tilt })), `None, tilt ${tilt}`).toBe(0);
      expect(share(scene3d(surrounded(value)(studio), { yaw: 225, tilt })), `${value}, tilt ${tilt}`).toBeGreaterThan(least);
    }
  }, 30_000);

  it.each(DRAWN)("%s: a floor's pixels at tilts 10, 35, 60 and 90 show no plate or line through them, against None apart from the framing", (value) => {
    // Every pixel, not every 3rd: with Grid's box cut removed (surroundings.16), its lines show on 39 of 1955 floor
    // pixels at tilt 10 and about 100 of 9161 at 35 (every 3rd: 5 and 13). At 60 and 90 they show on none, under the plate's
    // 5 mm drop, so those two tilts guard the plate alone and 10 and 35 carry the lines.
    const R = 2; // a floor pixel counts when its neighbours this far out are its colour too, so no outline or joint is near
    for (const tilt of [10, 35, 60, 90]) {
      const none = scene3d(studio, { yaw: 225, tilt });
      const withSurroundings = scene3d(surrounded(value)(studio), { yaw: 225, tilt });
      // A point's clip x and y under the styled camera from None's: both look along the same view, so it is a scale (the
      // pull, and On wheels' taller box) about None's centre, then the shift of the framed box's centre (its bottom).
      const [camNone, camStyled] = [camera3d(none.bounds, none.angles), camera3d(withSurroundings.bounds, withSurroundings.angles)];
      const scale = Math.hypot(...camStyled.matrix.slice(0, 3)) / Math.hypot(...camNone.matrix.slice(0, 3));
      const origin = { x: 0, y: 0, z: 0 };
      const [o, p] = [camNone.project(origin), camStyled.project(origin)];
      const styled = (cx: number, cy: number): [number, number] => [p.x + scale * (cx - o.x), p.y + scale * (cy - o.y)];
      const floors = new Set(none.faces.filter((f) => f.owner.startsWith("floor/")).map((f) => f.color));
      const [a, b] = [look3dPixels(none), look3dPixels(withSurroundings)];
      const n = a.width;
      const hex = (px: Uint8Array, i: number): string => `#${[0, 1, 2].map((c) => (px[i + c] ?? 0).toString(16).padStart(2, "0")).join("")}`;
      let samples = 0;
      const shown: string[] = [];
      for (let y = R; y < n - R; y++) {
        for (let x = R; x < n - R; x++) {
          const colour = hex(a.pixels, 4 * (y * n + x));
          if (!floors.has(colour)) continue;
          let clean = true;
          for (let dy = -R; dy <= R && clean; dy++) for (let dx = -R; dx <= R && clean; dx++) clean = hex(a.pixels, 4 * ((y + dy) * n + x + dx)) === colour;
          if (!clean) continue;
          samples++;
          // The same point under the styled camera.
          const [sx, sy] = styled(((x + 0.5) / n) * 2 - 1, 1 - ((y + 0.5) / n) * 2);
          const [px, py] = [Math.floor(((sx + 1) / 2) * n), Math.floor(((1 - sy) / 2) * n)];
          const j = 4 * (py * n + px);
          const want = [1, 3, 5].map((k) => parseInt(colour.slice(k, k + 2), 16));
          if ([0, 1, 2].some((c) => Math.abs((b.pixels[j + c] ?? 0) - (want[c] ?? 0)) > TOLERANCE)) shown.push(`${px},${py}: ${hex(b.pixels, j)} for ${colour}`);
        }
      }
      expect(samples, `tilt ${tilt}`).toBeGreaterThan(1500); // 1955 at tilt 10, where the floors are thin
      expect(shown.slice(0, 5), `tilt ${tilt}: ${shown.length} of ${samples} floor pixels changed`).toEqual([]);
    }
  }, 30_000);

  it("Grid: its lines change look's PNG at tilts 10, 35, 70 and 90, against the same scene without them (surroundings.16)", () => {
    // Catches lines lost between the scene and the raster: Grid's ride on a face with no outline (triangles3d). They
    // change 0.37 % of the pixels at tilt 10, 0.81 % at 90.
    for (const tilt of [10, 35, 70, 90]) {
      const scene = scene3d(surrounded("grid")(studio), { yaw: 225, tilt });
      const bare = { ...scene, faces: scene.faces.map(({ lines: _, ...f }) => f) };
      expect(scene.faces.some((f) => (f.lines ?? []).length > 0), `tilt ${tilt}`).toBe(true);
      const [a, b] = [look3dPixels(scene).pixels, look3dPixels(bare).pixels];
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) if ([0, 1, 2].some((c) => Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > TOLERANCE)) changed++;
      expect(changed / (a.length / 4), `tilt ${tilt}`).toBeGreaterThan(0.002);
    }
  }, 30_000);
});

describe.skipIf(!PERF)("look's speed, with FM_PERF=1 (real3d AC-12)", () => {
  const studio = drawing("studio");
  const studioState = index.pictures.find((p) => p.drawing === "studio")?.state ?? "";
  it("renders the studio in under a second (AC-12)", () => {
    const scene = lookScene3d(studio, studioState, DEFAULT_ANGLES);
    if ("refused" in scene) throw new Error(scene.refused);
    look3dPng(scene); // warm-up
    const t0 = performance.now();
    look3dPng(scene);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
