import { describe, expect, it } from "vitest";
import { LOGO_LONG_SIDE, MAX_LOGO_DATA_CHARS, MAX_UNDERLAY_DATA_CHARS, UNDERLAY_LONG_SIDE } from "@fm/protocol";
import { LOGO_BUDGET, encodeWithinBudget, nextAttempt, targetSize, type Attempt } from "../src/underlay-budget";

const CAP = MAX_UNDERLAY_DATA_CHARS;
const OVER = CAP + 1;
const first: Attempt = { longSide: UNDERLAY_LONG_SIDE, quality: 0.85 };

/** mulberry32, copied from packages/domain/test/helpers.ts (web tests don't import domain tests). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const label = (a: Attempt | "giveUp"): string => (a === "giveUp" ? a : `${a.longSide}/${a.quality}`);

describe("nextAttempt", () => {
  it("starts at the long-side cap and quality 0.85", () => {
    expect(nextAttempt(null, 0)).toEqual({ longSide: UNDERLAY_LONG_SIDE, quality: 0.85 });
  });

  it("a plain picture's first attempt passes", () => {
    expect(nextAttempt(first, 400_000)).toEqual(first);
    expect(nextAttempt(first, CAP)).toEqual(first);
    expect(nextAttempt(first, OVER)).not.toEqual(first);
  });

  it("over the cap, lowers quality once, then shrinks the long side by 0.8", () => {
    const seen: string[] = [];
    let a = nextAttempt(null, 0);
    seen.push(label(a));
    while (a !== "giveUp") {
      a = nextAttempt(a, OVER);
      seen.push(label(a));
    }
    expect(seen).toEqual(["2000/0.85", "2000/0.6", "1600/0.6", "1280/0.6", "1024/0.6", "giveUp"]);
  });

  it("gives up only below 1000 px", () => {
    expect(nextAttempt({ longSide: 1250, quality: 0.6 }, OVER)).toEqual({ longSide: 1000, quality: 0.6 });
    expect(nextAttempt({ longSide: 1249, quality: 0.6 }, OVER)).toBe("giveUp");
  });

  it("fuzz: every retry strictly decreases and stops within six attempts (seeded)", () => {
    const random = rng(7);
    const chars = (): number => Math.floor(random() * 3 * CAP);
    for (let chain = 0; chain < 2000; chain++) {
      let prev = nextAttempt(null, chars());
      let calls = 1;
      let allOver = true;
      let end: "fits" | "giveUp" | null = null;
      while (end === null && prev !== "giveUp") {
        const size = chars();
        const next = nextAttempt(prev, size);
        calls++;
        if (size <= CAP) {
          expect(next).toEqual(prev);
          end = "fits";
        } else if (next === "giveUp") {
          end = "giveUp";
        } else {
          expect(next.longSide).toBeLessThanOrEqual(prev.longSide);
          expect(next.quality).toBeLessThanOrEqual(prev.quality);
          expect(next.longSide < prev.longSide || next.quality < prev.quality).toBe(true);
          expect(next.longSide).toBeGreaterThanOrEqual(1000);
          expect(Number.isInteger(next.longSide)).toBe(true);
          prev = next;
        }
        allOver &&= size > CAP;
      }
      expect(calls).toBeLessThanOrEqual(6);
      if (allOver) expect(end).toBe("giveUp");
    }
  });
});

describe("targetSize", () => {
  it("shrinks a non-square picture to the long side", () => {
    expect(targetSize({ width: 4000, height: 3000 }, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("a picture taller than wide keeps its height as the long side", () => {
    expect(targetSize({ width: 3000, height: 4000 }, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("rounds an off-round size to whole pixels", () => {
    expect(targetSize({ width: 4001, height: 2999 }, 2000)).toEqual({ width: 2000, height: 1499 });
  });

  it("never upscales", () => {
    expect(targetSize({ width: 640, height: 480 }, 2000)).toEqual({ width: 640, height: 480 });
    expect(targetSize({ width: 5000, height: 1 }, 1600)).toEqual({ width: 1600, height: 1 });
  });

  it("fuzz (seeded)", () => {
    const random = rng(11);
    const sides = [2000, 1600, 1280, 1024];
    for (let i = 0; i < 1000; i++) {
      const W = 1 + Math.floor(random() * 10_000);
      const H = 1 + Math.floor(random() * 10_000);
      const longSide = sides[i % sides.length] ?? 2000;
      const { width, height } = targetSize({ width: W, height: H }, longSide);
      const scale = Math.min(1, longSide / Math.max(W, H));
      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(1);
      expect(Math.max(width, height)).toBe(Math.min(longSide, Math.max(W, H)));
      expect(Math.abs(width - W * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(height - H * scale)).toBeLessThanOrEqual(1);
    }
  });
});

describe("encodeWithinBudget", () => {
  const recording = (size: (a: Attempt) => number) => {
    const calls: string[] = [];
    const encode = (a: Attempt): Promise<string> => {
      calls.push(label(a));
      return Promise.resolve("x".repeat(size(a)));
    };
    return { calls, encode };
  };

  it("a plain picture is encoded once", async () => {
    const { calls, encode } = recording(() => 400_000);
    const out = await encodeWithinBudget(encode);
    expect(calls).toEqual(["2000/0.85"]);
    if (out === "tooLarge") throw new Error("expected data");
    expect(out.data).toHaveLength(400_000);
    expect(out.attempt).toEqual(first);
  });

  it("a noisy picture retries until it fits", async () => {
    const { calls, encode } = recording((a) => Math.round(a.longSide * a.longSide * a.quality * 0.5));
    const out = await encodeWithinBudget(encode);
    expect(calls).toEqual(["2000/0.85", "2000/0.6", "1600/0.6"]);
    if (out === "tooLarge") throw new Error("expected data");
    expect(out.attempt).toEqual({ longSide: 1600, quality: 0.6 });
    expect(out.data).toHaveLength(768_000);
  });

  it("a hopeless picture is tooLarge after the 1024 px attempt", async () => {
    const { calls, encode } = recording(() => OVER);
    expect(await encodeWithinBudget(encode)).toBe("tooLarge");
    expect(calls).toHaveLength(5);
    expect(calls.at(-1)).toBe("1024/0.6");
  });
});

describe("the logo's budget (sheetset.21)", () => {
  const OVER_LOGO = MAX_LOGO_DATA_CHARS + 1;

  it("starts at its own long side", () => {
    expect(nextAttempt(null, 0, LOGO_BUDGET)).toEqual({ longSide: LOGO_LONG_SIDE, quality: 0.85 });
  });

  it("its own cap decides, not the underlay's", () => {
    const start: Attempt = { longSide: LOGO_LONG_SIDE, quality: 0.85 };
    expect(nextAttempt(start, MAX_LOGO_DATA_CHARS, LOGO_BUDGET)).toEqual(start);
    expect(nextAttempt(start, OVER_LOGO, LOGO_BUDGET)).toEqual({ longSide: LOGO_LONG_SIDE, quality: 0.6 });
  });

  it("shrinks further than the underlay would before it gives up, as a logo is small anyway", () => {
    const seen: string[] = [];
    let a = nextAttempt(null, 0, LOGO_BUDGET);
    while (a !== "giveUp" && seen.length < 10) {
      seen.push(label(a));
      a = nextAttempt(a, OVER_LOGO, LOGO_BUDGET);
    }
    expect(seen).toEqual(["600/0.85", "600/0.6", "480/0.6", "384/0.6", "307/0.6", "245/0.6"]);
  });

  it("a picture over the cap is encoded smaller, and one that never fits is too large", async () => {
    const sizes: number[] = [];
    const fits = await encodeWithinBudget(async (a) => {
      sizes.push(a.longSide);
      return "x".repeat(a.longSide > 400 ? OVER_LOGO : 10);
    }, LOGO_BUDGET);
    expect(fits).toEqual({ data: "x".repeat(10), attempt: { longSide: 384, quality: 0.6 } });
    expect(sizes).toEqual([600, 600, 480, 384]);
    expect(await encodeWithinBudget(async () => "x".repeat(OVER_LOGO), LOGO_BUDGET)).toBe("tooLarge");
  });

  it("the underlay's own attempts are as they were", () => {
    expect(nextAttempt(null, 0)).toEqual({ longSide: UNDERLAY_LONG_SIDE, quality: 0.85 });
  });
});
