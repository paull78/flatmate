import { FALLS, FALLS_LABELS, ROOF_PRESETS, highSide, motifsFor, roofBox, roofCovering, roofOf, roofPresetOf, shown, type Document, type Falls, type Roof } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import type { Field } from "../view/view-model-types";
import { field, numberField, parseNumber, type FieldCommand } from "./fields";
import { finishCommand, finishRows } from "./zone-finish";

// The Ceiling section (heights.07, .11; roofs.03, .04, .14, .15): with nothing selected, the drawing's ceiling. Flat
// shows its height; a shed or gable its direction, low side, pitch (with percent and x/12), high side and overhang, and
// any of the three numbers may be typed, the domain's edit rule deciding what follows. Field ids are "ceiling.<name>".

const SECTION = "Ceiling";
const SHAPES = [{ value: "flat", label: "Flat" }, { value: "shed", label: "Shed" }, { value: "gable", label: "Gable" }];

const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);
/** The pitch in the other units people use (roofs.03): percent, and inches of rise per 12 of run. */
const pitchAs = (deg: number): string => `${(tan(deg) * 100).toFixed(1)}% · ${(tan(deg) * 12).toFixed(1)}/12`;
const alongX = (falls: Falls): boolean => falls === "-y" || falls === "+y"; // a gable falling across y has its ridge along x

/** "Length" for the box's longer axis, "Width" for the other. */
function axisLabels(doc: Document): { x: string; y: string } {
  const box = roofBox(doc);
  const xLonger = !box || box.maxX - box.minX >= box.maxY - box.minY;
  return xLonger ? { x: "Length", y: "Width" } : { x: "Width", y: "Length" };
}

function presetField(roof: Roof): Field {
  const options = [...ROOF_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom", disabled: true }];
  return { ...field(SECTION, "ceiling.preset", "Preset", roofPresetOf(roof)?.id ?? "custom", null, false), options, select: true };
}

function slopeFields(doc: Document, roof: Roof): Field[] {
  const shed = roof.shape === "shed";
  const axes = axisLabels(doc);
  const direction: Field = shed
    ? { ...field(SECTION, "ceiling.falls", "Low side", roof.falls, null, false), options: FALLS.map((f) => ({ value: f, label: FALLS_LABELS[f] })), select: true } // four don't fit as segments
    : { ...field(SECTION, "ceiling.ridge", "Ridge along", alongX(roof.falls) ? "x" : "y", null, false), options: [{ value: "x", label: axes.x }, { value: "y", label: axes.y }] };
  return [
    direction,
    numberField(SECTION, "ceiling.height", shed ? "Low wall" : "Eaves", shown(roof.height), "m", 0.05),
    numberField(SECTION, "ceiling.pitch", "Pitch", roof.pitch.toFixed(1), "°", 1),
    field(SECTION, "ceiling.pitchAs", "", pitchAs(roof.pitch), null),
    numberField(SECTION, "ceiling.highSide", shed ? "High wall" : "Ridge", shown(highSide(doc)), "m", 0.05),
    numberField(SECTION, "ceiling.overhang", "Overhang", shown(roof.overhang), "m", 0.05),
  ];
}

export function ceilingFields(state: EditorState): Field[] | null {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  const doc = visibleDoc(d);
  const roof = roofOf(doc);
  // The same controls for a shape whatever its values: the panel holds them while an edit awaits its answer (sheetset.68).
  const shape: Field = { ...field(SECTION, "ceiling.shape", "Shape", roof.shape, null, false), options: SHAPES };
  if (roof.shape === "flat") return [presetField(roof), shape, numberField(SECTION, "ceiling.height", "Height", shown(roof.height), "m", 0.05)];
  const covering = roofCovering(doc); // the roof's covering in a Roof section of its own (surfaces step 11)
  return [presetField(roof), shape, ...slopeFields(doc, roof), ...finishRows("Roof", "roof.", { id: "covering", label: "Covering" }, motifsFor("roof"), covering)];
}

const number = (value: string, make: (n: number) => FieldCommand): FieldCommand => {
  const n = parseNumber(value);
  return Number.isFinite(n) ? make(n) : "notANumber";
};

/** The command for a committed Ceiling field, or null for an id that is not one or a value that changes nothing. */
export function ceilingFieldCommand(doc: Document, fieldId: string, value: string): FieldCommand {
  switch (fieldId) {
    case "ceiling.height": return number(value, (height) => ({ type: "setCeiling", height }));
    case "ceiling.pitch": return number(value, (pitch) => ({ type: "setCeiling", pitch }));
    case "ceiling.highSide": return number(value, (high) => ({ type: "setCeiling", highSide: high }));
    case "ceiling.overhang": return number(value, (overhang) => ({ type: "setCeiling", overhang }));
    case "ceiling.shape": {
      const shape = value === "flat" || value === "shed" || value === "gable" ? value : null;
      return shape ? { type: "setCeiling", shape } : null;
    }
    case "ceiling.falls": {
      const falls = FALLS.find((f) => f === value);
      return falls ? { type: "setCeiling", falls } : null;
    }
    case "ceiling.ridge": { // keep the direction when it already crosses the ridge, else fall toward the bottom or the left
      if (value !== "x" && value !== "y") return null;
      if ((value === "x") === alongX(roofOf(doc).falls)) return null;
      return { type: "setCeiling", falls: value === "x" ? "-y" : "-x" };
    }
    case "ceiling.preset": {
      const p = ROOF_PRESETS.find((x) => x.id === value);
      return p ? { type: "setCeiling", shape: p.shape, height: p.height, pitch: p.pitch } : null;
    }
    default:
      if (!fieldId.startsWith("roof.")) return null;
      return finishCommand(roofCovering(doc), "covering", fieldId.slice("roof.".length), value, (finish) => ({ type: "setRoofCovering", finish }));
  }
}
