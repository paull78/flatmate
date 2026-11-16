import { useState, type PointerEvent } from "react";
import type { UiAction } from "@fm/editor";
import { DraftInput } from "./DraftInput";
import { angleFromPoint, arrowedAngle, typedNorth } from "./north-dial";

// The project's north, as on the mockup (sheetset.15; AC-10): a dial to drag or arrow, a box to type in, a switch for no
// arrow. Every edit redraws the visible pages, so a drag shows its angle here and commits once, on release. While an edit
// awaits its ack the dial and switch refuse rather than go disabled: a disabled element drops its focus, and the arrows with it.

const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

function angleAt(e: PointerEvent<SVGSVGElement>): number {
  const box = e.currentTarget.getBoundingClientRect();
  return angleFromPoint(e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2);
}

export function NorthDial({ north, readOnly, send }: { north: number | null; readOnly: boolean; send(action: UiAction): void }) {
  const [held, setHeld] = useState<number | null>(null); // the angle under a drag, not stored until it's let go
  const shown = held ?? north;
  const on = shown !== null;
  const angle = shown ?? 0;
  const setNorth = (value: string): void => send({ type: "setSheetSetting", key: "north", value });
  return (
    <div className="sheets-north-row">
      <svg
        className="sheets-dial"
        tabIndex={0}
        role="slider"
        aria-label="North angle"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={angle}
        aria-valuetext={on ? `${angle}° from up` : "No arrow"}
        viewBox="-42 -42 84 84"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setHeld(angleAt(e));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setHeld(angleAt(e));
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const next = angleAt(e); // the event's own: the last move's state may not have landed
          setHeld(null);
          if (next !== north) setNorth(String(next));
        }}
        onPointerCancel={() => setHeld(null)}
        onKeyDown={(e) => {
          const next = e.metaKey || e.ctrlKey || e.altKey ? null : arrowedAngle(north, e.key, e.shiftKey);
          if (next === null) return;
          e.preventDefault();
          if (!readOnly) setNorth(String(next));
        }}
      >
        <circle r="41" fill={on ? "#f4f4f2" : "#f7f7f5"} />
        {TICKS.map((tick) => (
          <line key={tick} x1="0" y1={tick % 90 === 0 ? -33 : -36} x2="0" y2="-39" transform={`rotate(${tick})`} stroke={on ? "#8f9296" : "#cfcfca"} strokeWidth={tick % 90 === 0 ? 1.5 : 1} />
        ))}
        <g transform={`rotate(${angle})`}>
          <path d="M0 -29 L7 12 L0 6 Z" fill={on ? "#1d1d1f" : "#cfcfca"} />
          <path d="M0 -29 L-7 12 L0 6 Z" fill={on ? "#8f9296" : "#e3e3df"} />
        </g>
      </svg>
      <div>
        <label className="sheets-toggle sheets-north-switch">
          <span>{on ? "Arrow on sheets" : "No arrow"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Show a north arrow"
            checked={on}
            onChange={(e) => {
              if (!readOnly) setNorth(e.target.checked ? "0" : "");
            }}
          />
        </label>
        <div className="sheets-north-num">
          <DraftInput
            type="number"
            min={0}
            max={359}
            aria-label="North angle in degrees"
            value={String(angle)}
            readOnly={readOnly}
            disabled={!on}
            onCommit={(text) => {
              const value = typedNorth(text);
              if (value !== null) setNorth(value);
            }}
          />
          <span className="sheets-help">° from up</span>
        </div>
      </div>
    </div>
  );
}
