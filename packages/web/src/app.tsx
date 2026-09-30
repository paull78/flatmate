import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";
import { CommandBar } from "./panels/CommandBar";
import { ProjectList } from "./panels/ProjectList";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { RendererToggle } from "./panels/RendererToggle";
import { StatusBar } from "./panels/StatusBar";
import { Toast } from "./panels/Toast";
import { Toolbar } from "./panels/Toolbar";
import type { RendererSwitch } from "./renderer-switch";
import type { EditorStore } from "./store";

export type AppProps = {
  store: EditorStore;
  renderer: RendererSwitch;
  /** `canvas` takes input and Canvas2D (or, under WebGL, the text overlay); `glCanvas` lies under it for WebGL. */
  mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void;
  serverMode?: boolean;
};

export function App({ store, renderer, mountCanvas, serverMode = false }: AppProps) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const choice = useSyncExternalStore(renderer.subscribe, renderer.getChoice);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (canvas === null || glCanvas === null) return undefined;
    return mountCanvas(canvas, glCanvas);
  }, [mountCanvas]);

  const send = useCallback((action: UiAction) => store.dispatch({ type: "ui", action }), [store]);

  return (
    <div className="app fm-app">
      <Toolbar view={view} send={send}>
        <RendererToggle choice={choice} onToggle={renderer.toggle} />
      </Toolbar>
      <div className="workspace">
        <div className="canvas-host fm-stage">
          <canvas ref={glCanvasRef} className="gl-canvas" data-testid="gl-canvas" aria-hidden="true" />
          <canvas ref={canvasRef} data-testid="canvas" style={{ cursor: view.cursor }} />
          {view.projectList !== null ? <ProjectList list={view.projectList} send={send} /> : null}
          {serverMode && view.project !== null ? (
            <button
              type="button"
              className="projects-button"
              // Keep focus off the button, like the toolbar: a focused button would also react to Space and Enter.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => send({ type: "showProjectList" })}
            >
              Projects
            </button>
          ) : null}
        </div>
        <PropertiesPanel view={view} send={send} />
      </div>
      <CommandBar view={view} />
      <StatusBar view={view} />
      <Toast view={view} />
    </div>
  );
}
