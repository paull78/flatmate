import type { Event as EditorEvent, UnderlayImport } from "@fm/editor";
import { LOGO_BUDGET, UNDERLAY_BUDGET, encodeWithinBudget, targetSize, type Attempt, type Budget } from "../underlay-budget";

// The picture importer (import.03, .14, .15), for the underlay and the studio's logo (sheetset.21): a dropped or chosen
// file → decode → shrink → JPEG within the budget → one action, or its refusal reason. Thin DOM glue, covered by e2e (the
// decisions are in underlay-budget.ts). The dispatch is async: of two quick drops the one finishing last wins, and an
// import that finishes after a project switch lands in the drawing then open (both accepted for now).

const SUPPORTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// The web can't import the domain's UNDERLAY_MIME; I16 refuses anything else.
const JPEG = "image/jpeg";

/** The four picture types every browser decodes; an allow-list, so HEIC and SVG are refused (import.03). */
export function isSupportedPicture(type: string): boolean {
  return SUPPORTED.has(type);
}

function jpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null || blob.type !== JPEG) reject(new Error("no JPEG"));
        else resolve(blob);
      },
      JPEG,
      quality,
    );
  });
}

/** The blob's base64 text: the data URL after its first comma. */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      const comma = url.indexOf(",");
      if (comma < 0) reject(new Error("no data URL"));
      else resolve(url.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function readPicture(file: File, budget: Budget): Promise<UnderlayImport> {
  if (!isSupportedPicture(file.type)) return { ok: false, reason: "unsupported" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    if (bitmap.width === 0 || bitmap.height === 0) return { ok: false, reason: "unreadable" };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null) return { ok: false, reason: "unreadable" };
    const encode = async (a: Attempt): Promise<string> => {
      const size = targetSize(bitmap, a.longSide);
      canvas.width = size.width;
      canvas.height = size.height; // resets the context state, so the smoothing is set after it
      // The default "low" smoothing can drop 1 px plan lines in a large shrink, and those are what `look` traces.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // JPEG has no alpha: without white first, a PNG's transparent areas turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      return base64(await jpegBlob(canvas, a.quality));
    };
    const out = await encodeWithinBudget(encode, budget);
    if (out === "tooLarge") return { ok: false, reason: "tooLarge" };
    return { ok: true, data: out.data, width: canvas.width, height: canvas.height };
  } catch {
    return { ok: false, reason: "unreadable" }; // no JPEG out of the canvas, or the blob couldn't be read
  } finally {
    bitmap.close();
  }
}

type Importer = { importFile(file: File): void; choosePicture(): void };

/** `importFile` takes a dropped file; `choosePicture` opens the file picker and must run inside the click. */
function createImporter(budget: Budget, done: (result: UnderlayImport) => void): Importer {
  const importFile = (file: File): void => {
    void readPicture(file, budget).then(done);
  };
  let input: HTMLInputElement | null = null;
  return {
    importFile,
    choosePicture() {
      if (input === null) {
        const el = document.createElement("input");
        el.type = "file";
        el.accept = [...SUPPORTED].join(",");
        el.hidden = true;
        el.addEventListener("change", () => {
          const file = el.files?.[0];
          el.value = ""; // so choosing the same file again fires change
          if (file !== undefined) importFile(file);
        });
        document.body.append(el);
        input = el;
      }
      // Synchronously, before any await: the picker needs the click's user activation.
      input.click();
    },
  };
}

export function createUnderlayImporter(dispatch: (e: EditorEvent) => void): Importer {
  return createImporter(UNDERLAY_BUDGET, (result) => dispatch({ type: "ui", action: { type: "importUnderlay", result } }));
}

export function createLogoImporter(dispatch: (e: EditorEvent) => void): Importer {
  return createImporter(LOGO_BUDGET, (result) => dispatch({ type: "ui", action: { type: "importLogo", result } }));
}
