import { describe, expect, it } from "vitest";
import { readCardOrder, writeCardOrder } from "../src/panels/card-order";

// The list's order is this browser's own (AC-15).

function fakeStorage() {
  const held = new Map<string, string>();
  return { getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => void held.set(k, v) };
}

describe("the remembered order", () => {
  it("is by name with nothing stored, or no storage at all", () => {
    expect(readCardOrder(() => fakeStorage())).toBe("name");
    expect(readCardOrder(() => null)).toBe("name");
  });

  it("comes back as it was saved", () => {
    const storage = fakeStorage();
    writeCardOrder(() => storage, "recent");
    expect(readCardOrder(() => storage)).toBe("recent");
    writeCardOrder(() => storage, "name");
    expect(readCardOrder(() => storage)).toBe("name");
  });

  it("ignores anything else stored", () => {
    const storage = fakeStorage();
    storage.setItem("fm.cardOrder", "colour");
    expect(readCardOrder(() => storage)).toBe("name");
  });

  it("falls back to name when storage throws, and saving doesn't throw", () => {
    const broken = () => ({
      getItem(): string | null {
        throw new Error("blocked");
      },
      setItem(): void {
        throw new Error("blocked");
      },
    });
    expect(readCardOrder(broken)).toBe("name");
    expect(() => writeCardOrder(broken, "recent")).not.toThrow();
  });
});
