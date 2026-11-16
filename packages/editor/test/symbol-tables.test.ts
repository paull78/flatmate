import { describe, expect, it } from "vitest";
import { BASIC } from "../src/view/symbols/basic";
import { BATHROOM } from "../src/view/symbols/bathroom";
import { KITCHEN } from "../src/view/symbols/kitchen";
import { SIT_AND_EAT } from "../src/view/symbols/sit-and-eat";
import { SLEEP } from "../src/view/symbols/sleep";
import { STORAGE } from "../src/view/symbols/storage";

// The group tables merge into one (furniture.ts): a key defined in two groups would silently draw the later one.
describe("symbol group tables", () => {
  it("no kind.configuration key appears in two groups", () => {
    const keys = [SLEEP, SIT_AND_EAT, KITCHEN, BATHROOM, STORAGE, BASIC].flatMap((t) => [...t.keys()]);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});
