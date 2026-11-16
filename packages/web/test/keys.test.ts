import { describe, expect, it } from "vitest";
import { isMac, keyLabel } from "../src/keys";

// Shortcut labels per platform (cleanup.09, AC-14): the editor names keys neutrally ("Mod+Z", "Delete"); the shell
// draws them as the platform does.

describe("keyLabel", () => {
  it("draws ⌘, ⇧ and ⌫ on a Mac", () => {
    expect(keyLabel("Mod+Z", true)).toBe("⌘Z");
    expect(keyLabel("Shift+Mod+Z", true)).toBe("⇧⌘Z");
    expect(keyLabel("Mod+Shift+Z", true)).toBe("⇧⌘Z"); // either input order
    expect(keyLabel("Delete", true)).toBe("⌫");
    expect(keyLabel("W", true)).toBe("W");
  });

  it("draws Ctrl+, Shift+ and Del elsewhere", () => {
    expect(keyLabel("Mod+Z", false)).toBe("Ctrl+Z");
    expect(keyLabel("Shift+Mod+Z", false)).toBe("Ctrl+Shift+Z"); // Windows and Linux order
    expect(keyLabel("Shift+3", false)).toBe("Shift+3");
    expect(keyLabel("Delete", false)).toBe("Del");
    expect(keyLabel("W", false)).toBe("W");
  });

  it("isMac reads a platform or user agent string", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMac("Win32")).toBe(false);
    expect(isMac("Node.js/22")).toBe(false);
  });
});
