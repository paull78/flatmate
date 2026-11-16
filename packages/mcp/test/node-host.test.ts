import { describe, expect, it } from "vitest";
import { isWireId } from "@fm/protocol";
import { createNodeHost } from "../src/node-host";

describe("createNodeHost", () => {
  it("hands out distinct IDs the protocol accepts", () => {
    const host = createNodeHost();
    const ids = [host.newId(), host.newId(), host.newId()];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(isWireId(id)).toBe(true);
  });

  it("has a clock that does not go backwards", () => {
    const host = createNodeHost();
    const t = host.now();
    expect(host.now()).toBeGreaterThanOrEqual(t);
  });
});
