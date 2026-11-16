import { describe, expect, it } from "vitest";
import { chainCommand } from "../src/tools/chain-edit";
import { roomDoc } from "./builders";

// The wall chain is edited at a level (cycle home, AC-08): the compiler refuses a call without one.

describe("chainCommand", () => {
  it("doesn't compile without a level", () => {
    const doc = roomDoc();
    // @ts-expect-error a level is required
    const withoutLevel = () => chainCommand(doc, Object.keys(doc.walls)[0] ?? "", 0, 1); // never called: the compiler is the test
    expect(withoutLevel).toBeTypeOf("function");
  });
});
