import { createRoot } from "react-dom/client";
import { initialState, type Scene } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { createEffectRunner } from "./adapters/effect-runner";
import { createTimers } from "./adapters/timers";
import { createWebGLRenderer } from "./adapters/webgl-renderer";
import { createWebHost } from "./adapters/web-host";
import { createWsServer, serverSink } from "./adapters/ws-server";
import { App } from "./app";
import { displayNameFrom, serverUrlFrom, tabClientId } from "./identity";
import { createRendererSwitch, rendererFrom, sdfDebugFrom } from "./renderer-switch";
import { createPerfMeter, perfFrom, primitiveCount } from "./perf";
import { createEditorStore } from "./store";
import "./styles.css";

// Composition root. Server mode when a server URL is known (?server= or VITE_SERVER_URL), otherwise
// local mode: one unsaved LocalDocument and no project list (spec §7.0, §10 step 4).
const host = createWebHost();
const clientId = tabClientId(sessionStorage, () => crypto.randomUUID());
const name = displayNameFrom(location.search);
const serverUrl = serverUrlFrom(location.search, import.meta.env.VITE_SERVER_URL);
const initial = initialState(
  {
    mode: serverUrl === null ? "local" : "server",
    me: { clientId, name },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
  },
  host,
);
// ?perf: times each update and each drawn frame (spec §6.3); off, nothing is measured.
const perf = perfFrom(location.search) ? createPerfMeter() : null;
const onFrame = perf === null ? undefined : (ms: number, scene: Scene) => perf.draw(ms, primitiveCount(scene));
const store = createEditorStore({ initial, host, onUpdate: perf?.update });
const timers = createTimers(store.dispatch);
// Canvas2D unless ?renderer=webgl (spec §1.4 step 10); the toolbar toggles it live.
const rendererSwitch = createRendererSwitch(rendererFrom(location.search));
// ?sdf=debug: WebGL shows its distance field (spec §6.2); Canvas2D ignores it.
const sdfDebug = sdfDebugFrom(location.search);

function mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void {
  // The socket opens asynchronously, so the runner below is in place before any server event arrives.
  const server = serverUrl === null ? null : createWsServer({ url: serverUrl, clientId, name, dispatch: store.dispatch });
  const runner = createEffectRunner({
    timers,
    server: server === null ? null : serverSink(server),
    onView: store.publishView,
  });
  store.setRunner(runner.run);
  // Under WebGL, `canvas` (on top, taking input) becomes the transparent text overlay over `glCanvas`.
  const detachRenderer = rendererSwitch.attach(
    { canvas2d: () => createCanvas2DRenderer(canvas, onFrame), webgl: (onLost) => createWebGLRenderer(glCanvas, canvas, onLost, { sdfDebug, onFrame }) },
    runner.setRenderer,
  );
  const detach = attachInput(canvas, store.dispatch); // sends viewportResized at once → first frame
  return () => {
    detach();
    server?.close();
    store.setRunner(() => {});
    detachRenderer();
  };
}

// Work that closing the tab would lose (spec §7.0, §7.7): local edits, or a submission whose outcome is unknown.
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
createRoot(root).render(<App store={store} renderer={rendererSwitch} mountCanvas={mountCanvas} serverMode={serverUrl !== null} perf={perf} />);
