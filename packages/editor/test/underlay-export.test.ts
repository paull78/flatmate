import { describe, expect, it } from "vitest";
import { roomDoc, underlayCommand, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The underlay never prints (import.06, .11; AC-07). The picture lies far outside the drawing, so an export whose
// bounds or primitives took it in would change.

const FAR = underlayCommand({ width: 2000, height: 1500, at: { x: -20.3, y: 31.7 } });

function exported(withUnderlay: boolean, format: "svg" | "pdf" | "png"): FakeShell {
  const shell = FakeShell.withDocument(withUnderlay ? withCommands(roomDoc(), FAR) : roomDoc());
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  return shell;
}

describe("exports leave the underlay out (AC-07)", () => {
  it.each(["svg", "pdf"] as const)("%s downloads are identical with and without an underlay", (format) => {
    const plain = exported(false, format).effectsOf("saveFile");
    const covered = exported(true, format).effectsOf("saveFile");
    expect(plain).toHaveLength(1);
    expect(covered.map((e) => e.name)).toEqual(plain.map((e) => e.name));
    expect(covered.map((e) => e.content)).toEqual(plain.map((e) => e.content));
  });

  it("the PNG download's page and size are identical", () => {
    const plain = exported(false, "png").effectsOf("rasterise");
    const covered = exported(true, "png").effectsOf("rasterise");
    expect(plain).toHaveLength(1);
    expect(covered.map((e) => e.page)).toEqual(plain.map((e) => e.page)); // never the requestId: it is a host id
    expect(covered.map((e) => e.size)).toEqual(plain.map((e) => e.size));
  });
});
