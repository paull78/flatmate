import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";
import { CommandBar } from "./panels/CommandBar";
import { PerfPanel } from "./panels/PerfPanel";
import { ProjectList } from "./panels/ProjectList";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { RendererToggle } from "./panels/RendererToggle";
import { StatusBar } from "./panels/StatusBar";
import { Toast } from "./panels/Toast";
import { Toolbar } from "./panels/Toolbar";
import type { PerfMeter } from "./perf";
import type { RendererKind, RendererSwitch } from "./renderer-switch";
import type { EditorStore } from "./store";

export type AppProps = {
  store: EditorStore;
  renderer: RendererSwitch;
  /** `canvas` takes input and Canvas2D (or, under WebGL, the text overlay); `glCanvas` lies under it for WebGL. */
  mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void;
  serverMode?: boolean;
  /** `?perf` (spec §6.3): shows the meter's numbers over the canvas. */
  perf?: PerfMeter | null;
};

export function App({ store, renderer, mountCanvas, serverMode = false, perf = null }: AppProps) {
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
          {perf !== null ? <PerfReadout meter={perf} renderer={choice.kind} /> : null}
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

/** Reads the meter twice a second; drawing it on every frame would add to what it measures. */
function PerfReadout({ meter, renderer }: { meter: PerfMeter; renderer: RendererKind }) {
  const [summary, setSummary] = useState(meter.summary);
  useEffect(() => {
    const id = setInterval(() => setSummary(meter.summary()), 500);
    return () => clearInterval(id);
  }, [meter]);
  return <PerfPanel summary={summary} renderer={renderer} />;
}
