import type { CSSProperties } from "react";
import type { Field } from "@fm/editor";
import { keepFocus } from "./keep-focus";
import type { PanelProps } from "./types";

// A finish's summary row in Properties (inherit step 04, AC-07): a swatch and "<pattern> · <colour>"; a click opens its
// fields under it (the editor keeps which one is open, so Esc closes it first). The swatch hints at the motif's joints
// with faint lines; the 3D view and the plan draw the real pattern.

/** Each motif's joint spacing in swatch pixels, rows then columns (0: none). */
const JOINTS: Readonly<Record<string, readonly [number, number]>> = {
  plain: [0, 0], planks: [4, 0], widePlanks: [6, 0], herringbone: [4, 4], squareTiles: [6, 6], largeTiles: [9, 9], mosaic: [3, 3],
  cementTiles: [6, 6], brick: [3, 6], subwayTiles: [3, 7], boardAndBatten: [0, 6], shingles: [4, 5], standingSeam: [0, 7],
  corrugated: [0, 3], roofTiles: [5, 6],
};

/** The swatch's background: the colour under its motif's faint joints, or a hatch for None. */
export function swatchStyle(motif: string | null, colour: string | null): CSSProperties {
  if (motif === null || colour === null) return { background: "repeating-linear-gradient(135deg, transparent 0 4px, var(--fm-line) 4px 5px)" };
  const [rows, cols] = JOINTS[motif] ?? [0, 0];
  const lines = [
    ...(rows > 0 ? [`repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px ${rows}px)`] : []),
    ...(cols > 0 ? [`repeating-linear-gradient(90deg, rgba(0,0,0,.22) 0 1px, transparent 1px ${cols}px)`] : []),
  ];
  return { background: [...lines, `linear-gradient(${colour}, ${colour})`].join(", ") };
}

/** The fields to draw: a closed summary row's fields are left out. */
export function shownFields(fields: readonly Field[]): Field[] {
  const open = new Set(fields.filter((f) => f.finish?.open).map((f) => f.id));
  return fields.filter((f) => f.inFinish === undefined || open.has(f.inFinish));
}

/** The summary row: its label, then a button with the swatch and the summary that opens or closes its fields. */
export function FinishSummary({ field, send }: { field: Field; send: PanelProps["send"] }) {
  const finish = field.finish;
  if (!finish) return null;
  if (finish.fixed) { // a side's inherited finish: shown, never opened (inherit step 05)
    return (
      <div className="prop-row prop-finish-row" data-field-id={field.id}>
        <span className="prop-label" title={field.label}>{field.label}</span>
        <span className="prop-finish prop-finish-fixed">
          <span className="prop-swatch" style={swatchStyle(finish.motif, finish.colour)} aria-hidden="true" />
          <span className="prop-finish-text">{field.value}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="prop-row prop-finish-row">
      <span className="prop-label" title={field.label}>{field.label}</span>
      <button
        type="button"
        className="prop-finish"
        data-finish-id={field.id}
        aria-expanded={finish.open}
        onMouseDown={keepFocus}
        onClick={() => send({ type: "toggleFinish", id: field.id })}
      >
        <span className="prop-swatch" style={swatchStyle(finish.motif, finish.colour)} aria-hidden="true" />
        <span className="prop-finish-text">{field.value}</span>
        <span className="prop-finish-chevron" aria-hidden="true">{finish.open ? "▴" : "▾"}</span>
      </button>
    </div>
  );
}
