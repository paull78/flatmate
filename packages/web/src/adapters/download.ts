import type { ExportContent } from "@fm/editor";
import { toPdf, toSvg } from "@fm/export";

// Downloads (export.18): the editor decides what a file holds; this adapter writes it with @fm/export and hands it to
// the browser.

/** The file for a saveFile effect's content: its text or bytes and its MIME type. */
export function fileFor(content: ExportContent): { data: string | Uint8Array<ArrayBuffer> | Blob; type: string } {
  switch (content.kind) {
    case "image":
      // The handle is the Blob the rasteriser made (rasterise.ts); anything else is a bug upstream.
      if (!(content.image instanceof Blob)) throw new Error("saveFile image is not a Blob");
      return { data: content.image, type: "image/png" };
    case "svg":
      return { data: toSvg(content.primitives, content.frame), type: "image/svg+xml" };
    case "pdf":
      return { data: Uint8Array.from(toPdf(content.pages)), type: "application/pdf" };
  }
}

/** Saves the content as a download named `name`, through a temporary object URL. */
export function downloadFile(name: string, content: ExportContent): void {
  const file = fileFor(content);
  const url = URL.createObjectURL(new Blob([file.data], { type: file.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
