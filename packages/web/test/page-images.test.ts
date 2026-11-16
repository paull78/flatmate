import { describe, expect, it } from "vitest";
import { createPageImages, type ImageContext } from "../src/adapters/page-images";

// A page's images on a canvas (sheetset.21): a page draws at once and a JPEG decodes later, so the image paints itself
// when it's ready, on the canvas that asked, unless that canvas has been drawn again since.

type Painted = { image: string; at: number[] };

function setup() {
  const loads: { src: string; onLoad: () => void }[] = [];
  const paint = createPageImages<string>((src, onLoad) => {
    loads.push({ src, onLoad });
    return src;
  });
  return { loads, paint };
}

function canvas(): { ctx: ImageContext<string>; painted: Painted[] } {
  const painted: Painted[] = [];
  return {
    painted,
    ctx: {
      drawImage(image, x, y, w, h) {
        painted.push({ image, at: [x, y, w, h] });
      },
    },
  };
}
const rect = { x: 10, y: 20, w: 30, h: 10 };
const same = (r: typeof rect) => r;

describe("page images", () => {
  it("nothing shows until it's decoded, then it paints once, where the page says", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    expect(loads.map((l) => l.src)).toEqual(["data:image/jpeg;base64,A"]);
    expect(painted).toEqual([]);
    loads[0]?.onLoad();
    expect(painted).toEqual([{ image: "data:image/jpeg;base64,A", at: [10, 20, 30, 10] }]);
    loads[0]?.onLoad();
    expect(painted).toHaveLength(1);
  });

  it("once decoded it paints with the page, with nothing to wait for", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    loads[0]?.onLoad();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    expect(painted).toHaveLength(2);
    expect(loads).toHaveLength(1); // one decode for every page and thumbnail
  });

  it("a page and a thumbnail waiting on one decode both paint, each at its own place", () => {
    const { loads, paint } = setup();
    const big = canvas();
    const thumb = canvas();
    paint(big.ctx, [{ rect, jpeg: "A" }], same);
    paint(thumb.ctx, [{ rect, jpeg: "A" }], (r) => ({ x: r.x / 10, y: r.y / 10, w: r.w / 10, h: r.h / 10 }));
    expect(loads).toHaveLength(1);
    loads[0]?.onLoad();
    expect(big.painted.map((p) => p.at)).toEqual([[10, 20, 30, 10]]);
    expect(thumb.painted.map((p) => p.at)).toEqual([[1, 2, 3, 1]]);
  });

  it("a canvas drawn again meanwhile keeps what it shows now: an old wait doesn't paint over it", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    paint(ctx, [], same); // the logo was removed, or the canvas took a page with none
    loads[0]?.onLoad();
    expect(painted).toEqual([]);
  });

  it("two draws waiting on one decode paint once, at the later draw's place", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    paint(ctx, [{ rect: { ...rect, x: 99 }, jpeg: "A" }], same); // resized: the first place is stale
    loads[0]?.onLoad();
    expect(painted.map((p) => p.at[0])).toEqual([99]);
  });

  it("a new logo decodes, and an old one still decoding doesn't paint on a canvas showing the new", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "A" }], same);
    paint(ctx, [{ rect, jpeg: "B" }], same);
    expect(loads).toHaveLength(2);
    loads[0]?.onLoad();
    expect(painted).toEqual([]);
    loads[1]?.onLoad();
    expect(painted.map((p) => p.image)).toEqual(["data:image/jpeg;base64,B"]);
  });

  it("one that never decodes just stays undrawn, and asks no more", () => {
    const { loads, paint } = setup();
    const { ctx, painted } = canvas();
    paint(ctx, [{ rect, jpeg: "bad" }], same);
    paint(ctx, [{ rect, jpeg: "bad" }], same);
    expect(loads).toHaveLength(1);
    expect(painted).toEqual([]);
  });
});
