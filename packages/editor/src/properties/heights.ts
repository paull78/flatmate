import { ceilingOver, configsOf, deckLabel, deckView, fitShapes, heightsOf, placementRange, rangeOf, roundMm, surfaceTop, type Document, type Heights, type LayoutObject, type Placement, shown } from "@fm/domain";
import type { Field } from "../view/view-model-types";
import { field, numberField, parseNumber, type FieldCommand } from "./fields";

// An object's Height section (heights.07, .25, .39): height, elevation and the "At ceiling" switch per configuration
// (labelled with the configuration when the kind has two), then the shown configuration's top and its gap to the
// ceiling. Every vertical fact comes from the domain's queries (heights.27). On a deck the elevation is measured from
// its top, "m above Loft", and the top stays absolute (decks.16).

const SECTION = "Height";

/** A configuration's elevation as Properties shows and stores it: from the top of what the piece stands on (decks.16). */
function relativeBottom(doc: Document, p: Placement, hz: Heights): number {
  return rangeOf(doc, hz, fitShapes(doc).get(p.id) ?? [], p.deck).bottom - surfaceTop(doc, p.deck);
}

export function heightFields(doc: Document, p: Placement, object: LayoutObject): Field[] {
  const configs = configsOf(object);
  const ring = fitShapes(doc).get(p.id) ?? [];
  const deck = p.deck === null ? null : deckView(doc, p.deck);
  const unit = deck ? `m above ${deckLabel(deck)}` : "m";
  const out: Field[] = configs.flatMap((c) => {
    const hz = heightsOf(object, c.id);
    if (!hz) return [];
    const tag = configs.length > 1 ? ` (${c.label})` : "";
    const atCeiling = hz.z === "ceiling";
    const bottom = relativeBottom(doc, p, hz);
    const elevation = atCeiling ? field(SECTION, `elevation.${c.id}`, `Elevation${tag}`, shown(bottom), unit) : numberField(SECTION, `elevation.${c.id}`, `Elevation${tag}`, shown(bottom), unit, 0.01);
    return [
      numberField(SECTION, `height.${c.id}`, `Height${tag}`, shown(hz.h), "m", 0.01),
      elevation,
      { ...field(SECTION, `atCeiling.${c.id}`, `At ceiling${tag}`, String(atCeiling), null, false), toggle: true },
    ];
  });
  const range = placementRange(doc, p.id);
  if (range) out.push(field(SECTION, "top", "Top", `${shown(range.top)} · ${shown(Math.max(0, ceilingOver(doc, ring) - range.top))} to ceiling`, null));
  return out;
}

/**
 * `height.<config>` and `elevation.<config>` set that configuration's value in every layout (heights.09);
 * `atCeiling.<config>` hangs it against the ceiling, or off, keeps it where it is now at that elevation (heights.25).
 * Null for another field.
 */
export function heightFieldCommand(doc: Document, p: Placement, object: LayoutObject, fieldId: string, value: string): FieldCommand {
  const [what = "", config] = fieldId.split(".");
  if (config === undefined || !configsOf(object).some((c) => c.id === config)) return null;
  const w = object.w[p.config] ?? 0;
  const size = { type: "setObjectSize", objectId: object.id, w, d: {} } as const;
  const n = parseNumber(value);
  switch (what) {
    case "height":
      return Number.isFinite(n) ? { ...size, h: { [config]: n } } : "notANumber";
    case "elevation":
      return Number.isFinite(n) ? { ...size, z: { [config]: n } } : "notANumber";
    case "atCeiling": {
      const hz = heightsOf(object, config);
      if (!hz || (value !== "true" && value !== "false")) return null;
      if (value === "true") return { ...size, z: { [config]: "ceiling" } };
      return { ...size, z: { [config]: roundMm(relativeBottom(doc, p, hz)) } };
    }
    default:
      return null;
  }
}
