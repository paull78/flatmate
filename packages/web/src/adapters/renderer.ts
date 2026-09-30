import type { Camera, Scene } from "@fm/editor";

/** Renderer port (spec §6): draws a platform-neutral Scene with a camera. */
export interface Renderer {
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}
