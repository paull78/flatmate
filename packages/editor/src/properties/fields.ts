import { shown, type Command, type GuardValue } from "@fm/domain";
import type { Field, ViewModel } from "../view/view-model-types";

// Properties (spec: tools, layouts, openings): one module per entity holds the fields the panel shows and the command each
// editable field sends, side by side, so a field and its decoding can't drift apart (arch-review R-11).

export type Properties = ViewModel["properties"];
/** A field's command; "notANumber" for a number field given something else; "notWhole" for a turn that isn't whole degrees; null when the value changes nothing. */
export type FieldCommand = Command | "notANumber" | "notWhole" | null;

export function field(section: string, id: string, label: string, value: string, unit: string | null, readOnly = true): Field {
  return { id, label, section, value, unit, readOnly };
}

/** An editable number with its stepper increment (0.01 m for sizes and lengths, 0.05 m for thickness, 1° for angles). */
export function numberField(section: string, id: string, label: string, value: string, unit: string, step: number): Field {
  return { ...field(section, id, label, value, unit, false), step };
}

/** The rows that select a hole (riser.20): "Hole 3.20 × 1.00", the first under `label`, the rest blank beneath it. */
export function holeRows(section: string, label: string, holes: readonly { id: string; w: number; d: number }[]): Field[] {
  return holes.map((h, i) => ({ ...field(section, `hole.${h.id}`, i === 0 ? label : "", `Hole ${shown(h.w)} × ${shown(h.d)}`, null), link: h.id }));
}

export const withOptions = (f: Field, options: { value: string; label: string }[]): Field => ({ ...f, options });

const GUARD_OPTIONS = [{ value: "railing", label: "Railing" }, { value: "glass", label: "Glass" }, { value: "none", label: "None" }];

/**
 * A guard's two fields (edges.14): its kind, labelled `label`, and its height in metres; a None guard's height is kept
 * but read-only. A deck's sides and a hole share them.
 */
export function guardFields(section: string, kindId: string, heightId: string, label: string, guard: GuardValue): Field[] {
  return [
    withOptions(field(section, kindId, label, guard.kind, null, false), GUARD_OPTIONS),
    guard.kind === "none" ? field(section, heightId, "Height", shown(guard.height), "m") : numberField(section, heightId, "Height", shown(guard.height), "m", 0.01),
  ];
}

/** A typed number; a blank field is not a number (Number("") would be 0). */
export function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}
