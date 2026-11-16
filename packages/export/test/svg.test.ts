import { describe, expect, it } from "vitest";
import type { LookFrame, Primitive } from "@fm/editor";
import { toSvg, type Frame } from "../src/svg";
import { download, MOSAIC, PLANKS } from "./finished-rooms";

// The SVG writer (export.17, AC-07): a picture's primitives framed on a rectangle of the world, in drawing units
// (millimetres on paper at the picture's zoom). World y points up; SVG y points down.

const FRAME: Frame = { min: { x: 0, y: 0 }, max: { x: 6, y: 4 }, zoom: 10 }; // 1:100: 10 mm per metre

/** Tags in order, with a balanced-nesting check: enough to call the output well-formed for this writer. */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (!name) return false;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|#)/.test(svg);
}

const attr = (el: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1];
const elements = (svg: string, tag: string): string[] => [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);

describe("toSvg (AC-07)", () => {
  it("is well-formed XML with a viewBox and a size in millimetres", () => {
    const svg = toSvg([], FRAME);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(wellFormed(svg)).toBe(true);
    const root = elements(svg, "svg")[0] ?? "";
    expect(attr(root, "viewBox")).toBe("0 0 60 40");
    expect(attr(root, "width")).toBe("60mm");
    expect(attr(root, "height")).toBe("40mm");
  });

  it("one user unit is one millimetre at 1:100: a 4 m wall spans 40 units", () => {
    const wall: Primitive = { kind: "segment", a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt" };
    const line = elements(toSvg([wall], FRAME), "line")[0] ?? "";
    expect(Number(attr(line, "x2")) - Number(attr(line, "x1"))).toBeCloseTo(40, 9);
    expect(attr(line, "stroke-width")).toBe("0.25");
  });

  it("flips the y axis once: world y up becomes SVG y down", () => {
    const seg: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 0, y: 4 }, width: { px: 1 }, color: "#000000", cap: "butt" };
    const line = elements(toSvg([seg], FRAME), "line")[0] ?? "";
    expect(Number(attr(line, "y1"))).toBeCloseTo(40, 9);
    expect(Number(attr(line, "y2"))).toBeCloseTo(0, 9);
  });

  it("walls are filled near-black shapes", () => {
    const fill: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 0.2 }], holes: [], color: "#1a1a1a" };
    const path = elements(toSvg([fill], FRAME), "path")[0] ?? "";
    expect(attr(path, "fill")).toBe("#1a1a1a");
    expect(attr(path, "d")).toBe("M0 40L60 40L60 38Z");
  });

  it("a polygon with holes is one path with a subpath per ring, filled even-odd", () => {
    const fill: Primitive = {
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
      holes: [[{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 1 }]],
      color: "#1a1a1a",
    };
    const path = elements(toSvg([fill], FRAME), "path")[0] ?? "";
    expect(attr(path, "d")).toBe("M0 40L40 40L40 0L0 0ZM10 30L10 10L30 10L30 30Z");
    expect(attr(path, "fill-rule")).toBe("evenodd");
    const wall: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 0.2 }], holes: [], color: "#1a1a1a" };
    expect(attr(elements(toSvg([wall], FRAME), "path")[0] ?? "", "fill-rule")).toBeUndefined();
  });

  it("a colour with alpha becomes a colour and an opacity", () => {
    const fill: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: "#e5484d80" };
    const path = elements(toSvg([fill], FRAME), "path")[0] ?? "";
    expect(attr(path, "fill")).toBe("#e5484d");
    expect(Number(attr(path, "fill-opacity"))).toBeCloseTo(128 / 255, 3);
  });

  it("text is SVG text, escaped, in the family its font names, anchored as aligned", () => {
    const label: Primitive = { kind: "text", text: "Bed & <Bath>", at: { x: 3, y: 2 }, size: 2.5, color: "#1a1a1a", align: "center", rotation: 0, font: "helvetica" };
    const svg = toSvg([label], FRAME);
    expect(wellFormed(svg)).toBe(true);
    expect(svg).toContain(">Bed &amp; &lt;Bath&gt;</text>");
    const text = elements(svg, "text")[0] ?? "";
    expect(attr(text, "font-family")).toBe("Helvetica, Arial, sans-serif");
    const inter = elements(toSvg([{ ...label, font: "inter" }], FRAME), "text")[0] ?? "";
    expect(attr(inter, "font-family")).toBe("Inter, sans-serif"); // render.15
    expect(attr(text, "style")).toBe("font-kerning:none"); // drawn as wide as measured, also by resvg in look
    expect(attr(text, "font-size")).toBe("2.5");
    expect(attr(text, "text-anchor")).toBe("middle");
    expect(attr(text, "x")).toBe("30");
    expect(attr(text, "y")).toBe("20");
  });

  it("a quarter-turned text is rotated −90° about its point", () => {
    const turned: Primitive = { kind: "text", text: "6.20", at: { x: 50, y: 50 }, size: 2.5, color: "#b3261e", align: "center", rotation: Math.PI / 2, font: "helvetica" };
    const text = elements(toSvg([turned], FRAME), "text")[0] ?? "";
    expect(attr(text, "transform")).toBe(`rotate(-90 ${attr(text, "x") ?? ""} ${attr(text, "y") ?? ""})`);
  });

  it("world-scaled widths and dashes", () => {
    const leaf: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { m: 0.04 }, color: "#000000", cap: "round", dash: [1, 2] };
    const line = elements(toSvg([leaf], FRAME), "line")[0] ?? "";
    expect(Number(attr(line, "stroke-width"))).toBeCloseTo(0.4, 9);
    expect(attr(line, "stroke-linecap")).toBe("round");
    expect(attr(line, "stroke-dasharray")).toBe("1 2");
  });

  it("an arc runs counter-clockwise in the world, from `from` to `to`", () => {
    // A quarter from 0 to 90°, radius 1 m about (3, 2): (4, 2) → (3, 3); on paper (40, 20) → (30, 10).
    const arc: Primitive = { kind: "arc", center: { x: 3, y: 2 }, radius: 1, from: 0, to: Math.PI / 2, width: { px: 0.18 }, color: "#000000" };
    const path = elements(toSvg([arc], FRAME), "path")[0] ?? "";
    expect(attr(path, "d")).toBe("M40 20A10 10 0 0 0 30 10");
    expect(attr(path, "fill")).toBe("none");
  });

  it("a disc is a circle of its drawing-unit radius", () => {
    const disc: Primitive = { kind: "disc", center: { x: 1, y: 1 }, radius: { px: 2 }, color: "#000000" };
    const circle = elements(toSvg([disc], FRAME), "circle")[0] ?? "";
    expect(attr(circle, "cx")).toBe("10");
    expect(attr(circle, "cy")).toBe("30");
    expect(attr(circle, "r")).toBe("2");
  });

  it("draws a white background unless told otherwise", () => {
    const rect = elements(toSvg([], FRAME), "rect")[0] ?? "";
    expect(attr(rect, "fill")).toBe("#ffffff");
    expect(elements(toSvg([], { ...FRAME, background: null }), "rect")).toEqual([]);
  });
});

// A frame with a non-zero origin, taller than wide: a wrong origin or y flip changes every number below.
const OFF_FRAME: Frame = { min: { x: -1.25, y: 0.4 }, max: { x: 3.5, y: 6.15 }, zoom: 10 };

const MIXED: Primitive[] = [
  { kind: "segment", a: { x: -0.6, y: 1.15 }, b: { x: 2.85, y: 5.3 }, width: { m: 0.04 }, color: "#1a1a1a", cap: "butt", dash: [0.8, 0.35] },
  {
    kind: "polygon",
    points: [{ x: -1, y: 0.6 }, { x: 3.1, y: 0.6 }, { x: 3.1, y: 5.9 }, { x: -1, y: 5.9 }],
    holes: [[{ x: 0.2, y: 1.7 }, { x: 0.2, y: 3.3 }, { x: 1.9, y: 3.3 }, { x: 1.9, y: 1.7 }]],
    color: "#1a1a1a",
  },
  { kind: "polygon", points: [{ x: 0.35, y: 4.1 }, { x: 2.6, y: 4.1 }, { x: 1.45, y: 5.55 }], holes: [], color: "#e5484d80" },
  { kind: "text", text: "A<&>B", at: { x: 1.1, y: 2.45 }, size: 2.5, color: "#b3261e", align: "left", rotation: Math.PI / 3, font: "helvetica" },
  { kind: "arc", center: { x: 0.75, y: 3.6 }, radius: 0.8, from: Math.PI / 6, to: (5 * Math.PI) / 4, width: { px: 0.18 }, color: "#000000" },
  { kind: "disc", center: { x: 2.95, y: 0.85 }, radius: { px: 1.5 }, color: "#2060c0" },
];

// The writer's output for MIXED, stored before the backdrop existed (import step 01): AC-07 keeps it byte for byte.
// Since render step 09 text names its family and is unkerned (render.15): "Helvetica, Arial, sans-serif" where it was
// "sans-serif", and style="font-kerning:none".
const MIXED_BODY = [
  `<line x1="6.5" y1="50" x2="41" y2="8.5" stroke="#1a1a1a" stroke-width="0.4" stroke-linecap="butt" stroke-dasharray="0.8 0.35"/>`,
  `<path d="M2.5 55.5L43.5 55.5L43.5 2.5L2.5 2.5ZM14.5 44.5L14.5 28.5L31.5 28.5L31.5 44.5Z" fill="#1a1a1a" fill-rule="evenodd"/>`,
  `<path d="M16 20.5L38.5 20.5L27 6Z" fill="#e5484d" fill-opacity="0.502"/>`,
  `<text x="23.5" y="37" font-family="Helvetica, Arial, sans-serif" font-size="2.5" text-anchor="start" dominant-baseline="central" style="font-kerning:none" fill="#b3261e" transform="rotate(-60 23.5 37)">A&lt;&amp;&gt;B</text>`,
  `<path d="M26.9282 21.5A8 8 0 1 0 14.3431 31.1569" fill="none" stroke="#000000" stroke-width="0.18"/>`,
  `<circle cx="42" cy="53" r="1.5" fill="#2060c0"/>`,
  `</svg>`,
];
const MIXED_HEAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 47.5 57.5" width="47.5mm" height="57.5mm">`;
const MIXED_RECT = `<rect x="0" y="0" width="47.5" height="57.5" fill="#ffffff"/>`;

describe("toSvg backdrop (look's picture under the plan; AC-07 without one)", () => {
  const BACKDROP = { data: "QUJD/+9w", rect: { minX: -0.5, minY: 1.1, maxX: 2.3, maxY: 5.85 }, fade: 0, grey: false };
  const zoomed: Frame = { ...OFF_FRAME, zoom: 20 };

  it("toSvg without a backdrop is byte-identical to before (stored string)", () => {
    expect(toSvg(MIXED, OFF_FRAME)).toBe([MIXED_HEAD, MIXED_RECT, ...MIXED_BODY].join("\n"));
    expect(toSvg(MIXED, { ...OFF_FRAME, background: null })).toBe([MIXED_HEAD, ...MIXED_BODY].join("\n"));
  });

  it("a backdrop is one stretched <image> after the background and before the first primitive", () => {
    const svg = toSvg(MIXED, { ...zoomed, backdrop: BACKDROP });
    expect(wellFormed(svg)).toBe(true);
    const images = elements(svg, "image");
    expect(images).toHaveLength(1);
    const image = images[0] ?? "";
    // y = (6.15 − 5.85) · 20: the picture's top edge is its rect's maxY.
    expect([attr(image, "x"), attr(image, "y"), attr(image, "width"), attr(image, "height")]).toEqual(["15", "6", "56", "95"]);
    expect(attr(image, "preserveAspectRatio")).toBe("none");
    expect(attr(image, "href")).toBe(`data:image/jpeg;base64,${BACKDROP.data}`);
    const rect = svg.indexOf("<rect");
    const img = svg.indexOf("<image");
    const first = svg.indexOf("<line");
    expect(rect).toBeGreaterThan(-1);
    expect(rect).toBeLessThan(img);
    expect(img).toBeLessThan(first);
  });

  it("backdrop fade is opacity 1 − fade; grey adds one sRGB desaturate filter", () => {
    const faded = elements(toSvg([], { ...zoomed, backdrop: { ...BACKDROP, fade: 0.7 } }), "image")[0] ?? "";
    expect(attr(faded, "opacity")).toBe("0.3");
    const full = elements(toSvg([], { ...zoomed, backdrop: BACKDROP }), "image")[0] ?? "";
    expect(attr(full, "opacity")).toBeUndefined();

    const grey = toSvg([], { ...zoomed, backdrop: { ...BACKDROP, grey: true } });
    expect(wellFormed(grey)).toBe(true);
    expect(attr(elements(grey, "image")[0] ?? "", "filter")).toBe("url(#fm-grey)");
    expect(elements(grey, "filter")).toEqual([`<filter id="fm-grey" color-interpolation-filters="sRGB">`]);
    expect(grey).toContain(`<filter id="fm-grey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>`);

    const colour = toSvg([], { ...zoomed, backdrop: BACKDROP });
    expect(attr(elements(colour, "image")[0] ?? "", "filter")).toBeUndefined();
    expect(colour).not.toContain("<filter");
  });

  it("a backdrop draws even with background null", () => {
    const svg = toSvg(MIXED, { ...zoomed, background: null, backdrop: BACKDROP });
    expect(svg).toContain("<image");
    expect(svg).not.toContain("<rect");
  });

  it("an editor LookFrame is an export Frame", () => {
    // The editor may not import @fm/export, so look's frame is the editor's own type: the typecheck pins the match.
    const look: LookFrame = { ...zoomed, background: "#ffffff", backdrop: { ...BACKDROP, fade: 0.5, grey: true } };
    const f: Frame = look;
    expect(attr(elements(toSvg([], f), "image")[0] ?? "", "opacity")).toBe("0.5");
  });
});

describe("finishes in the SVG (AC-12)", () => {
  const svgOf = (finishes?: "with" | "without"): string => {
    const content = download("svg", finishes);
    if (content.kind !== "svg") throw new Error("not an svg");
    return toSvg(content.primitives, content.frame);
  };

  it("with finishes (the default), contains the planks' base and line colours under the walls, and the mosaic's colour alone at 1:100", () => {
    const svg = svgOf();
    expect(svg).toContain(`fill="${PLANKS.fill}"`);
    expect(svg).toContain(`stroke="${PLANKS.line}"`);
    expect(svg).toContain(`fill="${MOSAIC.fill}"`);
    expect(svg).not.toContain(MOSAIC.line); // 0.025 m × 10 mm/m is under 0.8 mm
    expect(svg.indexOf(`fill="${PLANKS.fill}"`)).toBeLessThan(svg.indexOf('fill="#1a1a1a"')); // under the walls
  });

  it("without finishes, none of them", () => {
    const svg = svgOf("without");
    for (const c of [PLANKS.fill, PLANKS.line, MOSAIC.fill, MOSAIC.line]) expect(svg).not.toContain(c);
    expect(svg).toContain('fill="#1a1a1a"');
  });
});
