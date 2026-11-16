import { describe, expect, it } from "vitest";
import type { Event } from "@fm/editor";
import { createFrames } from "../src/adapters/frames";

describe("frames adapter (spec: layouts)", () => {
  it("two requestFrame effects before the animation frame fires produce one frame event, with the frame's time", () => {
    const pending: ((t: number) => void)[] = [];
    const events: Event[] = [];
    const frames = createFrames((e) => events.push(e), (cb) => { pending.push(cb); return pending.length; }, () => 0);
    frames.request();
    frames.request();
    expect(pending).toHaveLength(1);
    pending[0]?.(123.5);
    expect(events).toEqual([{ type: "frame", now: 123.5 }]);
    frames.request();
    expect(pending).toHaveLength(2);
  });

  it("dispose cancels a pending frame", () => {
    const cancelled: number[] = [];
    const frames = createFrames(() => {}, () => 7, (id) => void cancelled.push(id));
    frames.request();
    frames.dispose();
    expect(cancelled).toEqual([7]);
  });
});
