import type { View3dFrame } from "@fm/editor";
import type { Renderer3d } from "./adapters/renderer3d";
import { createWebgl3dRenderer } from "./adapters/webgl3d-renderer";

// The 3D panel's renderer (real3d.10): WebGL2, the only one. Where it can't start, or its context is lost, the panel
// says so in one line and the rest of the app carries on.

export const NO_WEBGL2 = "The 3D view needs WebGL2";

/** The note in place of the picture; it ignores frames. */
function unavailable(host: HTMLElement): Renderer3d {
  const note = document.createElement("div");
  note.className = "view3d-unavailable";
  note.dataset.testid = "view3d-unavailable";
  note.textContent = NO_WEBGL2;
  host.replaceChildren(note);
  return { render() {}, dispose() {} };
}

/** The 3D renderer on `host`; `onFrame` is `?perf`'s timer. */
export function createRenderer3d(host: HTMLElement, onFrame?: (ms: number) => void): Renderer3d {
  let disposed = false;
  const lost = (): void => {
    if (disposed) return;
    inner.dispose(); // the dead WebGL2 renderer: ignored from here on
    inner = unavailable(host);
  };
  let inner: Renderer3d = createWebgl3dRenderer(host, lost, onFrame) ?? unavailable(host);
  return {
    render(frame: View3dFrame | null) {
      inner.render(frame);
    },
    dispose() {
      disposed = true;
      inner.dispose();
    },
  };
}
