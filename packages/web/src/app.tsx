import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";

declare module "react" {
  interface CSSProperties {
    /** The level strip's row count, so the toast sits above it (styles.css). */
    "--fm-level-rows"?: number;
    "--fm-dock-fraction"?: string;
    "--fm-card-colour"?: string;
  }
}
import { CommandBar } from "./panels/CommandBar";
import { FloatingBar } from "./panels/FloatingBar";
import { Palette } from "./panels/Palette";
import { UnderPointerList } from "./panels/UnderPointerList";
import { PerfPanel } from "./panels/PerfPanel";
import { PresenceHead } from "./panels/PresenceHead";
import { ProjectHead } from "./panels/ProjectHead";
import { ProjectList, type MakeCard3d } from "./panels/ProjectList";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { FrameSash, moveFrames } from "./panels/Frame";
import { SectionStrip } from "./panels/SectionStrip";
import { CanvasCorner } from "./panels/RendererToggle";
import { LevelStrip } from "./panels/LevelStrip";
import { SheetsView } from "./panels/SheetsView";
import type { DrawPage } from "./panels/SheetPage";
import { StatePill } from "./panels/StatePill";
import { Toast } from "./panels/Toast";
import { Open3dChip, View3dPanel } from "./panels/View3dPanel";
import { WarningsPill } from "./panels/WarningsPill";
import type { PerfMeter } from "./perf";
import type { RendererKind, RendererSwitch } from "./renderer-switch";
import type { EditorStore } from "./store";
import { keepFocus } from "./panels/keep-focus";

type AppProps = {
  store: EditorStore;
  renderer: RendererSwitch;
  /** `canvas` takes input and Canvas2D (or, under a GPU renderer, the text overlay); `glCanvas` lies under it for WebGL, and WebGPU adds its own canvas beside it. */
  mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void;
  serverMode?: boolean;
  /** `?perf` (spec: rendering): shows the meter's numbers over the canvas. */
  perf?: PerfMeter | null;
  /** Opens the underlay's file picker (import.15): the Underlay section's Choose picture…, off while absent. */
  onChoosePicture?: () => void;
  /** Opens the logo's file picker (sheetset.21): the Project section's Choose picture…, off while absent. */
  onChooseLogo?: () => void;
  /** The 3D view's renderer host (heights.29); absent in shells without one. */
  mount3d?(host: HTMLDivElement): () => void;
  /** The project cards' shared 3D view (cards.02); absent, cards stay on their plans. */
  makeCard3d?: MakeCard3d;
  /** Draws a sheet's page on a canvas (the Canvas2D adapter); panels can't import adapters. */
  drawPage?: DrawPage;
};

const NO_DRAWING: DrawPage = () => {};

// Keep these with the same numbers in the style's --fm-dock-height.
const DOCK_MIN_PX = 200;
const PLAN_MIN_PX = 180;
const SASH_PX = 8;

/**
 * The shell (ux-polish item 7): palette column | canvas | Properties column. The floating bar, its hint line, the
 * layout pill and the corner chip float over the canvas; the side columns open with the project and presence heads.
 */
export function App({ store, renderer, mountCanvas, serverMode = false, perf = null, onChoosePicture, onChooseLogo, mount3d, makeCard3d, drawPage = NO_DRAWING }: AppProps) {
  // The third argument serves server rendering (the shell test); the browser reads the same snapshots.
  const view = useSyncExternalStore(store.subscribe, store.getView, store.getView);
  const choice = useSyncExternalStore(renderer.subscribe, renderer.getChoice, renderer.getChoice);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const view3dRef = useRef<HTMLDivElement>(null);
  const hasDrawing = view.view3d !== null;
  useEffect(() => {
    const host = view3dRef.current;
    if (host === null || mount3d === undefined || !hasDrawing) return undefined;
    return mount3d(host);
  }, [mount3d, hasDrawing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (canvas === null || glCanvas === null) return undefined;
    return mountCanvas(canvas, glCanvas);
  }, [mountCanvas]);

  const send = useCallback((action: UiAction) => store.dispatch({ type: "ui", action }), [store]);
  const { frames } = view;
  const stageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const swap = () => moveFrames(dockRef.current, () => send({ type: "swapFrames" }));
  const dragHeight = ({ y }: { y: number }) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (stage === undefined || stage.height === 0) return;
    const least = DOCK_MIN_PX / stage.height;
    const most = (stage.height - PLAN_MIN_PX - SASH_PX) / stage.height;
    send({ type: "setDockHeight", height: Math.max(least, Math.min(most, (stage.bottom - y - SASH_PX / 2) / stage.height)) }); // the style clamps it too, at any window size
  };
  const dragShare = ({ x }: { x: number }) => {
    const dock = dockRef.current?.getBoundingClientRect();
    if (dock === undefined || dock.width === 0) return;
    const left = (x - dock.left) / dock.width;
    send({ type: "setDockShare", sectionShare: frames.sectionFirst ? left : 1 - left });
  };

  return (
    <div className={`app fm-app${frames.docked ? " has-dock" : ""}`} style={{ "--fm-dock-fraction": `${frames.height * 100}%`, ...(view.levels === null ? {} : { "--fm-level-rows": view.levels.rows.length }) }}>
      {/* Nothing behind the sheets view takes the focus or a Tab. */}
      <div className="workspace" inert={view.sheetsView !== null}>
        <div className="side-column side-left" data-testid="palette-column">
          <ProjectHead view={view} />
          {view.project !== null ? <Palette view={view} send={send} /> : null}
        </div>
        <div className="stage-column" ref={stageRef}>
          <div className="canvas-host fm-stage">
            <canvas ref={glCanvasRef} className="gl-canvas" data-testid="gl-canvas" aria-hidden="true" />
            <canvas ref={canvasRef} data-testid="canvas" style={{ cursor: view.cursor }} />
            {view.underPointer !== null ? <UnderPointerList list={view.underPointer} send={send} /> : null}
            {view.projectList !== null ? <ProjectList list={view.projectList} send={send} makeCard3d={makeCard3d} /> : null}
            {perf !== null ? <PerfReadout meter={perf} renderer={choice.kind} open3d={view.view3d?.open === true} /> : null}
            {view.project !== null ? (
              <div className="canvas-top">
                <FloatingBar view={view} send={send} />
                <CommandBar view={view} send={send} />
              </div>
            ) : null}
            {view.projectList === null ? (
              <div className="pill-dock">
                <LevelStrip view={view} send={send} />
                <StatePill view={view} send={send} />
                <WarningsPill view={view} send={send} />
              </div>
            ) : null}
            {serverMode && view.project !== null ? (
              <button
                type="button"
                className="projects-button fm-float"
                // Keep focus off the button, like the tool buttons: a focused button would also react to Space and Enter.
                onMouseDown={keepFocus}
                onClick={() => send({ type: "showProjectList" })}
              >
                Projects
              </button>
            ) : null}
            {view.view3d !== null && !view.view3d.open ? <Open3dChip send={send} /> : null}
            {view.projectList === null ? <CanvasCorner choice={choice} onToggle={renderer.toggle} gridStep={view.gridStep} cut={view.cut} sectionMarks={view.sectionMarks} onSectionMarks={(on) => send({ type: "setSectionMarks", on })} /> : null}
          </div>
          {frames.docked ? <FrameSash across="height" testId="frames-sash" title="Drag to resize. Double-click to reset." onMove={dragHeight} onDoubleClick={() => send({ type: "resetDockHeight" })} /> : null}
          {/* One place for the 3D frame, in its corner or not, as its renderer keeps its element: CSS moves it. */}
          <div className="frames-dock" ref={dockRef} data-testid="frames-dock">
            {view.view3d !== null ? <View3dPanel view3d={view.view3d} frames={frames} send={send} hostRef={view3dRef} onSwap={swap} /> : null}
            {frames.side ? <FrameSash across="width" testId="frames-share" title="Drag to share the width" onMove={dragShare} /> : null}
            {view.sectionStrip !== null ? <SectionStrip strip={view.sectionStrip} frames={frames} drawPage={drawPage} send={send} onSwap={swap} /> : null}
          </div>
        </div>
        <div className="side-column side-right" data-testid="properties-column">
          <PresenceHead view={view} />
          <PropertiesPanel view={view} send={send} renderer={choice.kind} onChoosePicture={onChoosePicture} onChooseLogo={onChooseLogo} />
        </div>
      </div>
      {view.sheetsView !== null ? <SheetsView sheets={view.sheetsView} canUndo={view.canUndo} canRedo={view.canRedo} send={send} drawPage={drawPage} /> : null}
      <Toast view={view} />
    </div>
  );
}

/** Reads the meter twice a second; drawing it on every frame would add to what it measures. */
function PerfReadout({ meter, renderer, open3d }: { meter: PerfMeter; renderer: RendererKind; open3d: boolean }) {
  const [summary, setSummary] = useState(meter.summary);
  useEffect(() => {
    const id = setInterval(() => setSummary(meter.summary()), 500);
    return () => clearInterval(id);
  }, [meter]);
  return <PerfPanel summary={summary} renderer={renderer} open3d={open3d} />;
}
