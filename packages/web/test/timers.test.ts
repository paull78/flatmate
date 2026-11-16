import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event as EditorEvent } from "@fm/editor";
import { createTimers } from "../src/adapters/timers";

describe("timers adapter", () => {
  let fired: EditorEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches timerFired after the delay", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([{ type: "timerFired", timerId: "toast" }]);
  });

  it("fires each start once", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 100);
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveLength(1);
  });

  it("restarting a timer replaces the running one", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2000);
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([{ type: "timerFired", timerId: "toast" }]);
  });

  it("cancel prevents firing and ignores unknown IDs", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 100);
    timers.cancel("toast");
    timers.cancel("never-started");
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it("dispose cancels every timer", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("a", 100);
    timers.start("b", 200);
    timers.dispose();
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});
