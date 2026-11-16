import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colorChannels, sceneFaces, STYLE_3D, type Face3d, type View3dFrame } from "@fm/editor";

// The WebGL 3D renderer skips a frame it has drawn (graphics step 04, AC-05). The editor keeps a frame's identity while
// nothing it shows changes (step 03), so a pan, a hover or a drag's moves hand the renderer the same object.

const built = vi.hoisted(() => ({ calls: 0, faces: 0 }));
vi.mock("@fm/editor", async (importOriginal) => {
  const real = await importOriginal<typeof import("@fm/editor")>();
  return {
    ...real,
    sceneFaces: (...args: Parameters<typeof real.sceneFaces>) => {
      built.calls++;
      return real.sceneFaces(...args);
    },
  };
});
// Every face triangulated, counted: the ground's once, not once per scene (surroundings step 04).
vi.mock("@fm/render", async (importOriginal) => {
  const real = await importOriginal<typeof import("@fm/render")>();
  return {
    ...real,
    triangles3d: (...args: Parameters<typeof real.triangles3d>) => {
      built.faces += args[0].length;
      return real.triangles3d(...args);
    },
  };
});

const { createWebgl3dRenderer } = await import("../src/adapters/webgl3d-renderer");

const frame = (turn: 0 | 1 = 0): View3dFrame => ({
  scene: {
    items: [{ item: "floor", room: "r", ring: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], holes: [], color: null, lines: [], shapes: [] }],
    bounds: { min: { x: 0, y: 0 }, max: { x: 4, y: 3 }, top: 2.5 },
    hidden: new Set(),
  },
  angles: { yaw: 225 + 90 * turn, tilt: 35 },
  size: "corner",
});

/**
 * Every GL call counted by name, the last arguments of each in `args` and every `drawArrays`' vertex count in `drawn`;
 * enough of WebGL2 for the 3D renderer.
 */
function fakeGl(calls: Map<string, number>, args = new Map<string, unknown[]>(), drawn: unknown[] = []): WebGL2RenderingContext {
  const answers: Record<string, unknown> = { getShaderParameter: true, getProgramParameter: true, isContextLost: false, getAttribLocation: 0 };
  return new Proxy({}, {
    get(_, name: string) {
      return (...given: unknown[]) => {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        args.set(name, given);
        if (name === "drawArrays") drawn.push(given[2]);
        return name in answers ? answers[name] : {};
      };
    },
  }) as WebGL2RenderingContext;
}

describe("WebGL 3D skips a same frame (graphics step 04)", () => {
  let calls: Map<string, number>;
  let args: Map<string, unknown[]>;
  let drawn: unknown[];
  let rafs: (() => void)[];
  let resize: (() => void) | null;
  let canvas: { width: number; height: number; clientWidth: number; clientHeight: number; getContext(): WebGL2RenderingContext; addEventListener(): void; removeEventListener(): void; remove(): void };

  beforeEach(() => {
    calls = new Map();
    args = new Map();
    drawn = [];
    rafs = [];
    resize = null;
    built.calls = 0;
    built.faces = 0;
    const gl = fakeGl(calls, args, drawn);
    canvas = { width: 0, height: 0, clientWidth: 300, clientHeight: 200, getContext: () => gl, addEventListener() {}, removeEventListener() {}, remove() {} };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => rafs.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flush = (): void => {
    for (const cb of rafs.splice(0)) cb();
  };
  const draws = (): number => (calls.get("drawArrays") ?? 0) / 2; // fills, then edges

  function renderer(transparent = false) {
    const r = createWebgl3dRenderer({ replaceChildren() {} } as unknown as HTMLElement, () => {}, undefined, transparent);
    if (r === null) throw new Error("the fake context should start the renderer");
    return r;
  }

  it("draws and builds its triangles once for the same frame object", () => {
    const r = renderer();
    const f = frame();
    r.render(f);
    flush();
    r.render(f);
    flush();
    expect(draws()).toBe(1);
    expect(built.calls).toBe(1);
    expect(calls.get("bufferData")).toBe(2); // fills and edges, once
  });

  it("rebuilds for a new frame", () => {
    const r = renderer();
    r.render(frame(0));
    flush();
    r.render(frame(1));
    flush();
    expect(draws()).toBe(2);
    expect(built.calls).toBe(2);
  });

  it("redraws a resize from the cached triangles, without building them again", () => {
    const r = renderer();
    r.render(frame());
    flush();
    canvas.clientWidth = 600;
    resize?.();
    flush();
    expect(draws()).toBe(2);
    expect(built.calls).toBe(1);
  });

  it("redraws the same frame at a new devicePixelRatio (browser zoom, another screen)", () => {
    const r = renderer();
    const f = frame();
    r.render(f);
    flush();
    expect(canvas.width).toBe(300);
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    r.render(f);
    flush();
    expect(canvas.width).toBe(600);
    expect(built.calls).toBe(1); // from the cached triangles
  });

  it("clears on null and draws the same frame again after it (the view hidden and shown again)", () => {
    const r = renderer();
    const f = frame();
    r.render(f);
    flush();
    r.render(null);
    flush();
    r.render(f);
    flush();
    expect(calls.get("clear")).toBe(3);
    expect(draws()).toBe(2);
    expect(built.calls).toBe(1);
  });

  it("a drag that keeps the scene draws every step but builds and uploads the triangles once (real3d.11, AC-11)", () => {
    const r = renderer();
    const { scene } = frame();
    for (let step = 0; step < 20; step++) {
      r.render({ scene, angles: { yaw: 230 + step, tilt: 35 + step / 2 }, size: "corner" });
      flush();
    }
    expect(draws()).toBe(20);
    expect(built.calls).toBe(1);
    expect(calls.get("bufferData")).toBe(2); // fills and edges, once
  });

  it("the same frame after a different one draws again", () => {
    const r = renderer();
    const f = frame(0);
    r.render(f);
    flush();
    r.render(frame(1));
    flush();
    r.render(f);
    flush();
    expect(draws()).toBe(3);
  });

  it("the renderer clears to the scene's background, transparent still wins, and a skipped frame builds nothing", () => {
    const sky = "#eef3f5";
    const opaque = (hex: string): number[] => [...colorChannels(hex).slice(0, 3), 1];
    const styled: View3dFrame = { ...frame(), scene: { ...frame().scene, background: sky } };
    const r = renderer();
    r.render(styled);
    flush();
    expect(args.get("clearColor")).toEqual(opaque(sky));
    r.render(frame(1)); // no background: the palette's
    flush();
    expect(args.get("clearColor")).toEqual(opaque(STYLE_3D.background));
    r.render(styled);
    flush();
    r.render(null); // nothing frames the view (no walls): the palette's, and nothing built
    flush();
    expect(args.get("clearColor")).toEqual(opaque(STYLE_3D.background));
    expect(built.calls).toBe(3);
    expect(draws()).toBe(3);
    const card = renderer(true);
    card.render(styled);
    flush();
    expect(args.get("clearColor")).toEqual([0, 0, 0, 0]); // a card's grid shows through, whatever the scene's background
  });

  it("a styled frame is skipped when handed again, and a resize redraws it in its background without building again", () => {
    const sky = "#eef3f5";
    const styled: View3dFrame = { ...frame(), scene: { ...frame().scene, background: sky } };
    const r = renderer();
    r.render(styled);
    flush();
    r.render(styled); // the same object: nothing drawn, nothing built
    flush();
    expect(draws()).toBe(1);
    expect(built.calls).toBe(1);
    canvas.clientWidth = 600;
    resize?.();
    flush();
    expect(draws()).toBe(2);
    expect(built.calls).toBe(1); // from the cached triangles
    expect(args.get("clearColor")).toEqual([...colorChannels(sky).slice(0, 3), 1]);
  });

  it("a new scene over the same ground triangulates and uploads only the house, and still draws the ground", () => {
    // Two outline-free quads, as the ground's are: 12 fill vertices, where the house floor has 6 and its edges 8.
    const quad = (x: number): Face3d => ({
      points: [{ x, y: -2, z: -0.005 }, { x: x + 1, y: -2, z: -0.005 }, { x: x + 1, y: -1, z: -0.005 }, { x, y: -1, z: -0.005 }],
      holes: [], color: "#b9c9a3", owner: "ground/plate", outline: false,
    });
    const ground = [quad(0), quad(1)];
    const on = (turn: 0 | 1, g: readonly Face3d[]): View3dFrame => ({ ...frame(turn), scene: { ...frame().scene, ground: g, background: "#eef3f5" } });
    // The house's own faces, counted apart: a count taken from a render would soak up a ground triangulated with it.
    const house = sceneFaces(frame().scene).length;
    expect(house).toBeGreaterThan(0);
    const r = renderer();
    r.render(on(0, ground));
    flush();
    expect(built.faces).toBe(house + ground.length); // each once: the ground not in the house's triangles too
    expect(drawn).toContain(12);
    const uploads = calls.get("bufferData") ?? 0;
    drawn.length = 0;
    r.render(on(1, ground)); // a new scene (a flip's next frame, a selection) over the same ground
    flush();
    expect(built.faces).toBe(2 * house + ground.length); // the house again, the ground not
    expect((calls.get("bufferData") ?? 0) - uploads).toBe(2); // the house's fills and edges only
    expect(drawn).toContain(12); // the ground still drawn, from its kept triangles
    r.render(on(0, [quad(0), quad(1)])); // a new ground: triangulated again
    flush();
    expect(built.faces).toBe(3 * house + 2 * ground.length);
  });
});
