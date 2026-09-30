import type { Camera, Effect, Scene, ServerEffect, ViewModel } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { Renderer } from "./renderer";
import type { Timers } from "./timers";

export type { ServerEffect };
/** Built from the WebSocket adapter in server mode; local mode passes null. */
export type ServerEffectSink = (effect: ServerEffect) => void;

export type EffectRunnerDeps = {
  timers: Timers;
  server: ServerEffectSink | null;
  onView(view: ViewModel): void;
};

export type EffectRunner = {
  /** Performs effects in order (spec §5.2); results come back later as events. */
  run(effects: Effect[]): void;
  /**
   * Draws with `renderer` from now on and hands it the last rendered scene at once: the editor emits `render`
   * only after events, so a renderer swap (spec §1.4 step 10) would otherwise show nothing until the next one.
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
            deps.onView(effect.view);
            break;
          case "startTimer":
            deps.timers.start(effect.timerId, effect.ms);
            break;
          case "cancelTimer":
            deps.timers.cancel(effect.timerId);
            break;
          case "workspace":
          case "submit":
          case "presence":
            if (deps.server !== null) deps.server(effect);
            break;
          case "saveSnapshot":
            // Local-folder workspace is follow-up X1 (spec §7.8); the initial build never emits it.
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
