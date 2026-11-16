import { describe, expect, it } from "vitest";
import { furnitureSymbol } from "../src/view/furniture";
import { FROZEN_SHOWER_TRAY } from "./fixtures/shower-tray-symbol";

// The shower tray already matches its reference (symbols AC-13): its symbol is frozen, from the code before the cycle.

describe("the shower tray's symbol", () => {
  it.each([["0.80 × 0.80", 0.8, 0.8], ["0.80 × 1.20", 0.8, 1.2]] as const)("is unchanged at %s", (key, w, d) => {
    const now: unknown = JSON.parse(JSON.stringify(furnitureSymbol("showerTray", "standard", w, d)));
    expect(now).toEqual(FROZEN_SHOWER_TRAY[key]);
  });
});
