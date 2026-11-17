import type { Changeset, EntityKey, Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Primitive, Scene } from "../view/scene-types";
import type { ViewModel } from "../view/view-model-types";
import type { View3dFrame } from "../view3d/types";

// Async work the core asks the shell to do (spec: editor). Results come back as events.
export type WorkspaceOp =
  | { type: "list"; requestId: string }
  | { type: "create"; requestId: string; name: string }
  | { type: "delete"; requestId: string; projectId: string }
  | { type: "open"; projectId: string; generation: string }
  | { type: "close"; projectId: string; generation: string } // leaving a drawing for the list
  | { type: "read"; requestId: string; projectId: string };

/**
 * What a download holds (export.18): the editor decides the content; the shell turns it into a file with @fm/export.
 * SVG: the picture's primitives framed on `min`–`max` at `zoom` drawing units per metre. PDF: the sheet's pages.
 */
export type ExportContent =
  | { kind: "svg"; primitives: Primitive[]; frame: { min: Point; max: Point; zoom: number } }
  | { kind: "pdf"; pages: ExportPage[] } // the sheet's pages (export/sheet.ts)
  | { kind: "image"; image: ImageHandle }; // a raster the shell made (rasterise → rasterised)

/** A shell's image (a PNG it rasterised): the core only passes it on, never reads it (spec: editor). */
export type ImageHandle = unknown;

/** A page in millimetres, origin at the bottom-left corner, y up: a PDF sheet page or a preview. */
export type ExportPage = { widthMm: number; heightMm: number; primitives: Primitive[]; clips?: readonly PageClip[]; images?: readonly PageImage[] };

/**
 * A base64 JPEG stretched over `rect` (sheetset.21), millimetres with (x, y) its bottom-left corner, above the primitives
 * and outside any clip. Not a Primitive, as every writer and renderer would have to switch on it (import.11).
 */
export type PageImage = { rect: { x: number; y: number; w: number; h: number }; jpeg: string };

/**
 * Primitives `from` up to `to` drawn only inside `rect` (sheetset.17), millimetres with (x, y) its bottom-left corner.
 * A page's clips run in order and don't overlap. No clip on SVG: `toSvg` takes primitives, not pages.
 */
export type PageClip = { rect: { x: number; y: number; w: number; h: number }; from: number; to: number };

export type Effect =
  | { type: "render"; scene: Scene; view: ViewModel; camera: Camera; view3d: View3dFrame | null } // the shell never reads editor state
  | { type: "workspace"; op: WorkspaceOp }
  | { type: "saveSnapshot"; projectId: string; writeId: string; content: string } // X1: declared, never emitted
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[]; state: string | null; level: string | null }
  | { type: "startTimer"; timerId: string; ms: number }
  | { type: "requestFrame" } // ask the shell for one animation frame event (the flip, spec: layouts)
  | { type: "cancelTimer"; timerId: string }
  | { type: "saveFile"; name: string; content: ExportContent } // a download (export.18)
  // Draw a page to an image of `size` pixels; answered by a `rasterised` event with an opaque handle (export.18).
  | { type: "rasterise"; requestId: string; page: ExportPage; size: { w: number; h: number } };
