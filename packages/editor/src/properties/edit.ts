import { jointFieldCommand } from "./joint";
import { areaFieldCommand } from "./area";
import { MESSAGES, isWallThickness } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { showToast } from "../toast";
import { cantRead, readValue } from "../typed-value";
import type { FieldCommand } from "./fields";
import { ceilingFieldCommand, ceilingFields } from "./ceiling";
import { outsideFieldCommand, outsideFields } from "./outside";
import { openFinishRow } from "./open-finish";
import { columnFieldCommand } from "./column";
import { deckFieldCommand } from "./deck";
import { holeFieldCommand } from "./hole";
import { objectFieldCommand } from "./object";
import { openingFieldCommand } from "./opening";
import { properties } from "./view";
import { projectFieldCommand } from "./project";
import { trailerFieldCommand } from "./trailer";
import { sectionFieldCommand } from "./section";
import { wallFieldCommand } from "./wall";
import { zoneFieldCommand } from "./zone";

/**
 * Properties-panel edits (`ui setField`, spec: tools): the selected entity's module turns the field into a command, which
 * commits like any edit, so undo works. Read-only fields send nothing.
 */
export function setField(state: EditorState, fieldId: string, value: string, host: Host): Step {
  const read = readField(state, fieldId, value);
  if (read === null) return showToast(state, cantRead(value), host);
  const cmd = fieldCommand(state, fieldId, read);
  if (cmd === null) return { state, effects: [] };
  if (cmd === "notANumber") return showToast(state, cantRead(value), host);
  if (cmd === "notWhole") return showToast(state, "Type a whole number of degrees", host);
  const out = runCommand(state, cmd, host); // the domain refuses a thickness out of range (I13) with the same toast
  // Customize opens the side's new Finish row, ready to change (inherit step 05, M2 hands-on).
  const side = cmd.type === "setWallSide" && fieldId.endsWith(".customize") ? cmd.side : null;
  return { state: side ? openFinishRow(out.state, `row:${side}.finish`) : out.state, effects: out.effects };
}

/**
 * What a field's command gets: a number field's sum and units read here, in one place, as plain text it can parse (its
 * unit says whether it takes units); any other field's value as it is, and a blank, which the command refuses or gives
 * a meaning (a section's Depth). Null when a number field can't read it.
 */
function readField(state: EditorState, fieldId: string, value: string): string | null {
  const selected = properties(state);
  const shown = "fields" in selected ? selected.fields : [...(ceilingFields(state) ?? []), ...(outsideFields(state) ?? [])];
  const f = shown.find((candidate) => candidate.id === fieldId);
  if (f?.step === undefined || value.trim() === "") return value;
  const n = readValue(value, f.unit === "m" ? "metres" : "plain");
  return n === null ? null : String(n);
}

/** The Wall tool's thickness (layout-states.27); a value it can't read or outside the allowed range keeps the setting and toasts. */
export function setWallThickness(state: EditorState, value: string, host: Host): Step {
  const thickness = readValue(value, "metres");
  if (thickness === null) return showToast(state, cantRead(value), host);
  if (!isWallThickness(thickness)) return showToast(state, MESSAGES.thickness, host);
  return { state: { ...state, wallThickness: thickness }, effects: [] };
}

function fieldCommand(state: EditorState, fieldId: string, value: string): FieldCommand {
  const ref = state.selection[0];
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || state.selection.length > 1) return null; // a group has no fields (direct.08)
  if (!ref) return projectFieldCommand(fieldId, value) ?? trailerFieldCommand(fieldId, value) ?? outsideFieldCommand(doc, fieldId, value) ?? ceilingFieldCommand(doc, fieldId, value); // nothing selected: Project (sheet.04), Trailer, Outside walls, Ceiling
  switch (ref.table) {
    case "walls":
      return doc.walls[ref.id]?.column ? columnFieldCommand(doc, ref.id, fieldId, value) : wallFieldCommand(doc, ref.id, fieldId, value);
    case "zoneLabels":
      return zoneFieldCommand(doc, ref.id, fieldId, value);
    case "placements":
      return objectFieldCommand(doc, ref.id, fieldId, value);
    case "openings":
      return openingFieldCommand(doc, ref.id, fieldId, value);
    case "decks":
      return deckFieldCommand(doc, ref.id, fieldId, value);
    case "joints":
      return jointFieldCommand(ref.id, fieldId); // Join walls (straight.05)
    case "deckHoles":
      return holeFieldCommand(ref.id, fieldId, value);
    case "sections":
      return sectionFieldCommand(doc, ref.id, fieldId, value);
    case "areas":
      return areaFieldCommand(ref.id, fieldId, value);
    case "states":
    case "objects":
    case "dimensions":
    case "projectFields":
    case "underlays":
    case "logos":
    case "ceilings":
    case "sheets":
      return null;
    default:
      return assertNever(ref.table);
  }
}
