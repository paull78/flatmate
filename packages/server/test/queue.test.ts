import { describe, expect, it } from "vitest";
import { KeyedQueue } from "../src/app/queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("KeyedQueue", () => {
  it("runs the tasks of one key strictly one at a time, in order", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const first = deferred();
    const a = queue.run("p1", async () => {
      log.push("a start");
      await first.promise;
      log.push("a end");
      return "a";
    });
    const b = queue.run("p1", async () => {
      log.push("b start");
      return "b";
    });
    await tick();
    expect(log).toEqual(["a start"]);
    first.resolve();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b start"]);
  });

  it("runs different keys independently", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const hold = deferred();
    const a = queue.run("p1", async () => {
      log.push("p1");
      await hold.promise;
    });
    await queue.run("p2", async () => {
      log.push("p2");
    });
    expect(log).toEqual(["p1", "p2"]); // p2 finished while p1 is still waiting
    hold.resolve();
    await a;
  });

  it("rejects the caller of a failed task and still runs the next one", async () => {
    const queue = new KeyedQueue();
    const failed = queue.run("p1", async () => {
      throw new Error("boom");
    });
    const next = queue.run("p1", async () => "next");
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe("next");
  });

  it("idle waits for every task, including tasks queued meanwhile", async () => {
    const queue = new KeyedQueue();
    const done: string[] = [];
    void queue.run("p1", async () => {
      await tick();
      done.push("a");
      void queue.run("p2", async () => {
        await tick();
        done.push("b");
      });
    });
    await queue.idle();
    expect(done).toEqual(["a", "b"]);
  });
});
