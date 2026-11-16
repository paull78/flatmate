import { describe, expect, it } from "vitest";
import { fileFor } from "../src/adapters/download";

// A saveFile effect's content becomes a file (export.18): the shell translates with @fm/export.

describe("fileFor", () => {
  it("turns SVG content into SVG text with its MIME type", () => {
    const file = fileFor({
      kind: "svg",
      primitives: [{ kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt" }],
      frame: { min: { x: 0, y: 0 }, max: { x: 4, y: 3 }, zoom: 10 },
    });
    expect(file.type).toBe("image/svg+xml");
    expect(typeof file.data === "string" && file.data.startsWith("<svg")).toBe(true);
    expect(file.data).toContain('x2="40"');
  });

  it("turns PDF content into PDF bytes", () => {
    const file = fileFor({ kind: "pdf", pages: [{ widthMm: 210, heightMm: 297, primitives: [] }] });
    expect(file.type).toBe("application/pdf");
    expect(file.data instanceof Uint8Array).toBe(true);
    const head = file.data instanceof Uint8Array ? String.fromCharCode(...file.data.slice(0, 8)) : "";
    expect(head).toBe("%PDF-1.4");
  });

  it("passes a rasterised image through as a PNG", () => {
    const blob = new Blob(["png"], { type: "image/png" });
    expect(fileFor({ kind: "image", image: blob })).toEqual({ data: blob, type: "image/png" });
  });
});
