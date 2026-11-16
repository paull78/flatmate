import type { Camera, Scene } from "@fm/editor";

/** Renderer port (spec: rendering): draws a platform-neutral Scene with a camera. */
export interface Renderer {
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

/** Called after each drawn frame with its time in ms (the `?perf` readout, spec: rendering). */
export type OnFrame = (ms: number, scene: Scene) => void;
