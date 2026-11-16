import { describe, expect, it } from "vitest";
import { isSupportedPicture } from "../src/adapters/underlay-import";

describe("isSupportedPicture", () => {
  it("accepts the four browser picture types", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) expect(isSupportedPicture(type)).toBe(true);
  });

  it("refuses PDF, HEIC and everything else", () => {
    // HEIC and SVG are refused even where the browser could decode them (import.03).
    for (const type of ["application/pdf", "image/heic", "image/heif", "image/svg+xml", "text/plain", ""]) expect(isSupportedPicture(type)).toBe(false);
  });
});
