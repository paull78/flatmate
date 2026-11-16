import { useRef, useState, type PointerEvent, type Ref } from "react";
import type { UiAction, ViewModel } from "@fm/editor";
import { IS_MAC, keyLabel } from "../keys";
import { FrameButton, FrameHead, FrameSeparator } from "./Frame";
import { SurroundingsMenu } from "./SurroundingsMenu";

type Props = { view3d: NonNullable<ViewModel["view3d"]>; frames: ViewModel["frames"]; send(action: UiAction): void; hostRef: Ref<HTMLDivElement>; onSwap(): void };

/**
 * The 3D view's frame (heights.07, .18, section.46): the title bar (surroundings, turn left and right, corner or dock, close) over the renderer's
 * host, which stays mounted while closed so the renderer keeps its element. Read-only: clicks never reach the plan.
 * A primary-button drag on the host orbits the view, a double-click resets it (real3d.04): the panel only forwards
 * pixel deltas; the editor owns the degrees and the tilt's range.
 */
export function View3dPanel({ view3d, frames, send, hostRef, onSwap }: Props) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = last.current;
    if (from === null) return;
    const [dx, dy] = [e.clientX - from.x, e.clientY - from.y];
    if (dx === 0 && dy === 0) return;
    last.current = { x: e.clientX, y: e.clientY };
    send({ type: "orbit3d", dx, dy });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current === null) return;
    last.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const docked = view3d.size === "split";
  const larger = () => send({ type: "toggleLargerDock" });
  return (
    <div
      className={`view3d-panel frame${view3d.open ? "" : " view3d-closed"}${docked ? "" : " view3d-corner"}`}
      data-testid="view3d-panel"
      data-size={view3d.size}
      data-yaw={view3d.yaw}
      data-tilt={view3d.tilt}
      style={docked ? { order: frames.sectionFirst ? 2 : 0, flexGrow: frames.side ? 1 - frames.sectionShare : 1 } : undefined}
    >
      {view3d.open ? (
        <FrameHead label="3D" layout={view3d.layout} onDoubleClick={docked ? larger : undefined}>
          <SurroundingsMenu menu={view3d.surroundings} send={send} />
          {view3d.roof === null ? null : (
            <FrameButton
              icon="roof"
              action="roof3d"
              pressed={view3d.roof}
              title={view3d.outside ? (view3d.roof ? "Hide the outside walls" : "Show the outside walls") : view3d.roof ? "Hide the roof" : "Show the roof"}
              onClick={() => send({ type: "toggleRoof3d" })}
            />
          )}
          <FrameButton icon="left" action="turn3d-left" title="Turn left ([)" onClick={() => send({ type: "turn3d", by: -1 })} />
          <FrameButton icon="right" action="turn3d-right" title="Turn right (])" onClick={() => send({ type: "turn3d", by: 1 })} />
          <FrameSeparator />
          <FrameButton
            icon="corner"
            action="size3d"
            title={`${docked ? "Small, in the corner" : "Larger, under the plan"} (${keyLabel("Shift+3", IS_MAC)})`}
            onClick={() => send({ type: "set3dSize", size: docked ? "corner" : "split" })}
          />
          {frames.side ? <FrameButton icon="swap" action="swap-frames" title="Swap the frames" onClick={onSwap} /> : null}
          {docked ? <FrameButton icon={frames.larger ? "smaller" : "larger"} action="larger-frames" title={frames.larger ? "Back to the usual size" : "Larger"} onClick={larger} /> : null}
          <FrameButton icon="close" action="close3d" title="Close the 3D view (3)" onClick={() => send({ type: "toggle3d" })} />
        </FrameHead>
      ) : null}
      <div
        className={`view3d-host${dragging ? " view3d-dragging" : ""}`}
        data-testid="view3d"
        ref={hostRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => send({ type: "reset3d" })}
      />
    </div>
  );
}

/** The chip that reopens a closed 3D view (heights.07). */
export function Open3dChip({ send }: { send(action: UiAction): void }) {
  return (
    <button type="button" className="open3d-chip fm-float" data-testid="open3d" title="Show the 3D view (3)" onMouseDown={(e) => e.preventDefault()} onClick={() => send({ type: "toggle3d" })}>
      3D
    </button>
  );
}
