import { colorChannels, FONT_FAMILY, type Primitive, type Width } from "@fm/editor";
import { assertNever, type Point } from "@fm/protocol";

/**
 * The part of the world an SVG shows: `min` to `max` in metres, at `zoom` drawing units per metre (10 at 1:100, so
 * one unit is a paper millimetre; export.13, AC-07). The background is white unless null.
 */
export type Frame = { min: Point; max: Point; zoom: number; background?: string | null; backdrop?: Backdrop };

/**
 * A picture stretched over `rect` (world metres, the domain's Box shape) under the primitives: look's underlay
 * (import.11). `data` is base64 JPEG, the only mime the drawing stores. `fade` as on screen: 0 full strength, 1 gone.
 */
type Backdrop = { data: string; rect: { minX: number; minY: number; maxX: number; maxY: number }; fade: number; grey: boolean };

const PAPER = "#ffffff";
const ANCHOR = { left: "start", center: "middle", right: "end" } as const;

/** SVG text for primitives framed on `frame`, sized in millimetres. Pure: no DOM. */
export function toSvg(primitives: readonly Primitive[], frame: Frame): string {
  const w = n((frame.max.x - frame.min.x) * frame.zoom);
  const h = n((frame.max.y - frame.min.y) * frame.zoom);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">`];
  const background = frame.background === undefined ? PAPER : frame.background;
  if (background !== null) out.push(`<rect x="0" y="0" width="${w}" height="${h}"${paint("fill", background)}/>`);
  if (frame.backdrop) out.push(...backdrop(frame.backdrop, frame));
  for (const p of primitives) out.push(element(p, frame));
  out.push("</svg>");
  return out.join("\n");
}

function element(p: Primitive, f: Frame): string {
  switch (p.kind) {
    case "segment": {
      const a = at(f, p.a);
      const b = at(f, p.b);
      const dash = p.dash && p.dash.length > 0 ? ` stroke-dasharray="${p.dash.map(n).join(" ")}"` : "";
      return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"${paint("stroke", p.color)} stroke-width="${n(width(p.width, f))}" stroke-linecap="${p.cap}"${dash}/>`;
    }
    case "polygon": {
      // One subpath per ring; even-odd cuts the holes out whatever their winding.
      const ring = (r: readonly Point[]) => r.map((q) => at(f, q)).map((q, i) => `${i === 0 ? "M" : "L"}${n(q.x)} ${n(q.y)}`).join("") + "Z";
      const d = [p.points, ...p.holes.filter((h) => h.length >= 3)].map(ring).join("");
      const rule = p.holes.length > 0 ? ` fill-rule="evenodd"` : "";
      return `<path d="${d}"${paint("fill", p.color)}${rule}/>`;
    }
    case "arc":
      return `<path d="${arcPath(p.center, p.radius, p.from, p.to, f)}" fill="none"${paint("stroke", p.color)} stroke-width="${n(width(p.width, f))}"/>`;
    case "disc": {
      const c = at(f, p.center);
      return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(width(p.radius, f))}"${paint("fill", p.color)}/>`;
    }
    case "text": {
      const c = at(f, p.at);
      const turn = p.rotation !== 0 ? ` transform="rotate(${n((-p.rotation * 180) / Math.PI)} ${n(c.x)} ${n(c.y)})"` : "";
      return (
        `<text x="${n(c.x)}" y="${n(c.y)}" font-family="${FONT_FAMILY[p.font]}" font-size="${n(p.size)}" text-anchor="${ANCHOR[p.align]}" ` +
        `dominant-baseline="central" style="font-kerning:none"${paint("fill", p.color)}${turn}>${escape(p.text)}</text>`
      );
    }
    default:
      return assertNever(p);
  }
}

/** One `<image>`, top edge at the rect's maxY; grey is an sRGB filter, since the default linearRGB shifts the greys. */
function backdrop(b: Backdrop, f: Frame): string[] {
  const top = at(f, { x: b.rect.minX, y: b.rect.maxY });
  const size = `width="${n((b.rect.maxX - b.rect.minX) * f.zoom)}" height="${n((b.rect.maxY - b.rect.minY) * f.zoom)}"`;
  const opacity = b.fade > 0 ? ` opacity="${n(1 - b.fade)}"` : "";
  const filter = b.grey ? ` filter="url(#fm-grey)"` : "";
  const image =
    `<image href="data:image/jpeg;base64,${b.data}" x="${n(top.x)}" y="${n(top.y)}" ${size} ` +
    `preserveAspectRatio="none"${opacity}${filter}/>`;
  if (!b.grey) return [image];
  const grey = `<defs><filter id="fm-grey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  return [grey, image];
}

/** World metres to SVG units: x from the left, y down from the top. */
function at(f: Frame, p: Point): Point {
  return { x: (p.x - f.min.x) * f.zoom, y: (f.max.y - p.y) * f.zoom };
}

/** Drawing-unit widths stay as they are; world widths scale with the frame. */
function width(w: Width, f: Frame): number {
  return "px" in w ? w.px : w.m * f.zoom;
}

/**
 * Counter-clockwise in the world from `from` to `to`: clockwise on screen, so SVG's sweep flag is 0. Whole turns are
 * drawn as two halves, which one SVG arc command cannot.
 */
function arcPath(center: Point, radius: number, from: number, to: number, f: Frame): string {
  const r = n(radius * f.zoom);
  const point = (angle: number): Point => at(f, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  const span = to - from;
  const steps = Math.abs(span) >= 2 * Math.PI - 1e-9 ? [from, from + span / 2, to] : [from, to];
  const start = point(from);
  let d = `M${n(start.x)} ${n(start.y)}`;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1] ?? from;
    const b = steps[i] ?? to;
    const end = point(b);
    const large = Math.abs(b - a) > Math.PI ? 1 : 0;
    const sweep = b >= a ? 0 : 1;
    d += `A${r} ${r} 0 ${large} ${sweep} ${n(end.x)} ${n(end.y)}`;
  }
  return d;
}

/** A colour as `#rrggbb` and, when not opaque, an opacity, both from the one parser (render.12). */
function paint(attr: "fill" | "stroke", color: string): string {
  const [r, g, b, a] = colorChannels(color);
  const hex = `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
  return a === 1 ? ` ${attr}="${hex}"` : ` ${attr}="${hex}" ${attr}-opacity="${n(a)}"`;
}

/** Numbers to at most four decimals, without trailing zeros or negative zero. */
function n(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
