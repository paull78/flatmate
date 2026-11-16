import type { Camera, Effect, ExportContent, ExportPage, Scene, ServerEffect, View3dFrame, ViewModel } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { Renderer } from "./renderer";
import type { Frames } from "./frames";
import type { Timers } from "./timers";

export type { ServerEffect };
/** Built from the WebSocket adapter in server mode; local mode passes null. */
export type ServerEffectSink = (effect: ServerEffect) => void;

type EffectRunnerDeps = {
  timers: Timers;
  frames: Pick<Frames, "request">;
  server: ServerEffectSink | null;
  onView(view: ViewModel): void;
  save(name: string, content: ExportContent): void; // a download (export.18)
  rasterise(requestId: string, page: ExportPage, size: { w: number; h: number }): void; // a PNG, answered by an event
  render3d?(frame: View3dFrame | null): void; // the 3D panel (heights.29), when the shell has one
};

type EffectRunner = {
  /** Performs effects in order (spec: editor); results come back later as events. */
  run(effects: Effect[]): void;
  /**
   * Draws with `renderer` from now on and hands it the last rendered scene at once: the editor emits `render`
   * only after events, so a renderer swap (docs/try-it.md step 10) would otherwise show nothing until the next one.
   */
  setRenderer(renderer: Renderer): void;
};

export function createEffectRunner(deps: EffectRunnerDeps): EffectRunner {
  let renderer: Renderer | null = null;
  let last: { scene: Scene; camera: Camera } | null = null;
  return {
    run(effects) {
      for (const effect of effects) {
        switch (effect.type) {
          case "render":
            last = { scene: effect.scene, camera: effect.camera };
            renderer?.render(effect.scene, effect.camera);
            deps.render3d?.(effect.view3d);
            deps.onView(effect.view);
            break;
          case "startTimer":
            deps.timers.start(effect.timerId, effect.ms);
            break;
          case "cancelTimer":
            deps.timers.cancel(effect.timerId);
            break;
          case "requestFrame":
            deps.frames.request();
            break;
          case "workspace":
          case "submit":
          case "presence":
            if (deps.server !== null) deps.server(effect);
            break;
          case "saveFile":
            deps.save(effect.name, effect.content);
            break;
          case "rasterise":
            deps.rasterise(effect.requestId, effect.page, effect.size);
            break;
          case "saveSnapshot":
            // Local-folder workspace is follow-up X1 (spec: roadmap); the initial build never emits it.
            break;
          default:
            assertNever(effect);
        }
      }
    },
    setRenderer(next) {
      renderer = next;
      if (last !== null) next.render(last.scene, last.camera);
    },
  };
}
