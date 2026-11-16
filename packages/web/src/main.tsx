import { createRoot } from "react-dom/client";
import { initialState, type Scene } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { downloadFile } from "./adapters/download";
import { loadInter } from "./adapters/fonts";
import { createRasteriser, drawPage } from "./adapters/rasterise";
import { createEffectRunner } from "./adapters/effect-runner";
import { createFrames } from "./adapters/frames";
import { createTimers } from "./adapters/timers";
import { createLogoImporter, createUnderlayImporter } from "./adapters/underlay-import";
import { createWebGLRenderer } from "./adapters/webgl-renderer";
import { createWebGPURenderer } from "./adapters/webgpu-renderer";
import { acquireGpu, exposeGpuLoss, type GpuKit } from "./adapters/webgpu/kit";
import { createWebHost } from "./adapters/web-host";
import { createWsServer, serverSink } from "./adapters/ws-server";
import { App } from "./app";
import { displayNameFrom, serverUrlFrom, serverUrlProblem, tabClientId } from "./identity";
import { createRendererSwitch, rendererFrom, sdfDebugFrom } from "./renderer-switch";
import type { Renderer3d } from "./adapters/renderer3d";
import { createWebgl3dRenderer } from "./adapters/webgl3d-renderer";
import { createRenderer3d } from "./view3d-renderer";
import type { View3dFrame } from "@fm/editor";
import { createPerfMeter, exposePerf, perfFrom, primitiveCount } from "./perf";
import { createEditorStore } from "./store";
import "./styles.css";
import { ErrorBoundary, FailurePage } from "./panels/ErrorBoundary";

// Composition root. Server mode when a server URL is known (?server= or VITE_SERVER_URL), otherwise
// local mode: one unsaved LocalDocument and no project list (spec: collaboration step 4).
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
// ?perf: times each update and each drawn frame (spec: rendering); off, nothing is measured.
const perf = perfFrom(location.search) ? createPerfMeter() : null;
const onFrame =
  perf === null
    ? undefined
    : (ms: number, scene: Scene) => {
        perf.draw(ms, primitiveCount(scene));
        perf.frame(performance.now());
      };
const onFrame3d = perf === null ? undefined : perf.draw3d;
// The perf spec (graphics step 02) resets and reads the meter around each gesture.
if (perf !== null) exposePerf(window, perf);
const store = createEditorStore({ initial, host, onUpdate: perf?.update });
const timers = createTimers(store.dispatch);
const frames = createFrames(store.dispatch);
// The underlay picture (import.15): dropped on the canvas or picked with the Underlay section's Choose picture….
const importer = createUnderlayImporter(store.dispatch);
const logoImporter = createLogoImporter(store.dispatch); // the studio's, from Project in Properties (sheetset.21)
// Canvas2D unless ?renderer=webgl or webgpu (docs/try-it.md step 10, spec: rendering); the canvas corner chip toggles it live.
const rendererKind = rendererFrom(location.search);
const rendererSwitch = createRendererSwitch(rendererKind);
// ?renderer=webgpu: the device and pipelines are set up before mount (webgpu.10); null when WebGPU can't draw here.
let gpuKit: GpuKit | null = null;
// ?sdf=debug: WebGL shows its distance field (spec: rendering); Canvas2D ignores it.
const sdfDebug = sdfDebugFrom(location.search);
// The 3D view (heights.29, real3d.10): WebGL2 on the panel's host; the last frame redraws a new mount.
let renderer3d: Renderer3d | null = null;
let last3d: View3dFrame | null = null;
function render3d(frame: View3dFrame | null): void {
  last3d = frame;
  renderer3d?.render(frame);
}
function mount3d(host: HTMLDivElement): () => void {
  const r = createRenderer3d(host, onFrame3d);
  renderer3d = r;
  r.render(last3d);
  return () => {
    if (renderer3d === r) renderer3d = null;
    r.dispose();
  };
}

/** The project cards' one 3D view (cards.02). */
const makeCard3d = (host: HTMLElement, onLost: () => void): Renderer3d | null => createWebgl3dRenderer(host, onLost, onFrame3d, true);

function mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void {
  // The socket opens asynchronously, so the runner below is in place before any server event arrives.
  const server = serverUrl === null ? null : createWsServer({ url: serverUrl, clientId, name, dispatch: store.dispatch });
  const runner = createEffectRunner({
    timers,
    frames,
    server: server === null ? null : serverSink(server),
    onView: store.publishView,
    save: downloadFile,
    rasterise: createRasteriser(store.dispatch),
    render3d,
  });
  store.setRunner(runner.run);
  // Under WebGL or WebGPU, `canvas` (on top, taking input) becomes the transparent text overlay over the GPU canvas.
  const detachRenderer = rendererSwitch.attach(
    {
      canvas2d: () => createCanvas2DRenderer(canvas, onFrame),
      webgl: (onLost) => createWebGLRenderer(glCanvas, canvas, onLost, { sdfDebug, onFrame }),
      // Always offered; the list tries it only for ?renderer=webgpu, and it returns null without a kit (webgpu.10).
      webgpu: (onLost) => createWebGPURenderer(glCanvas, canvas, gpuKit, onLost, { onFrame }),
    },
    runner.setRenderer,
  );
  const detach = attachInput(canvas, store.dispatch, importer.importFile); // sends viewportResized at once → first frame
  return () => {
    detach();
    server?.close();
    store.setRunner(() => {});
    detachRenderer();
  };
}

// Work that closing the tab would lose (spec: collaboration): local edits, or a submission whose outcome is unknown.
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
// The bundled Inter loads before the first frame, so no text is ever drawn in a font the core didn't measure (render.15).
// With ?renderer=webgpu the GPU kit is built alongside it, within its own timeout (webgpu.10).
void Promise.all([loadInter(), rendererKind === "webgpu" ? acquireGpu() : Promise.resolve(null)]).then(([, kit]) => {
  gpuKit = kit;
  if (perf !== null && kit !== null) exposeGpuLoss(window, kit); // the e2e's device loss (AC-04)
  const problem = serverUrlProblem(serverUrl);
  createRoot(root).render(
    problem !== null ? (
      <FailurePage title="Can't reach the server" detail={problem} reload={false} />
    ) : (
      <ErrorBoundary>
        <App store={store} renderer={rendererSwitch} mountCanvas={mountCanvas} makeCard3d={makeCard3d} drawPage={drawPage} serverMode={serverUrl !== null} perf={perf} onChoosePicture={importer.choosePicture} onChooseLogo={logoImporter.choosePicture} mount3d={mount3d} />
      </ErrorBoundary>
    ),
  );
});
