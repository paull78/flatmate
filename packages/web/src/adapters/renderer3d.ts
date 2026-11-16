import type { View3dFrame } from "@fm/editor";

/**
 * The 3D view's renderer port (heights.29): draws the editor's 3D frame, plain data, into its panel; null clears it.
 * WebGL2 draws it (real3d.10); the note that replaces it on a lost context is the port's other side, so main.tsx never
 * knows which is mounted.
 */
export interface Renderer3d {
  render(frame: View3dFrame | null): void;
  dispose(): void;
}
