import { MOTIFS, motifsFor, deckView, firstLabelId, isMotifId, shown, withMotif, type Command, type Document, type Finish, type MotifId } from "@fm/domain";
import { deckFinishes, roomFinishes } from "../view/finish/rooms";
import { zoneOfLabel } from "../view/tags";
import type { Field } from "../view/view-model-types";
import { field, numberField, parseNumber, withOptions, type FieldCommand } from "./fields";

// A floor finish's fields (AC-08, finishes.08): Floor, then with a finish its colour and numbers, in the Room section of
// a label and the Deck section of a deck (deck-floors.02). Values go to the domain as typed; `setFinish` and
// `setDeckFinish` lower-case the colour and refuse a bad value naming the range (finishes.27, .40), and that refusal is
// the toast, so the ranges have one owner.

/** The suggested colours, by name (the spec's motifs section); any `#rrggbb` is allowed besides. */
const SWATCHES: readonly { name: string; colour: string }[] = [
  { name: "Oak", colour: "#c8a27a" },
  { name: "Light oak", colour: "#d8bc94" },
  { name: "Walnut", colour: "#7a5236" },
  { name: "Grey oak", colour: "#a99c8a" },
  { name: "Warm white", colour: "#e8e4dc" },
  { name: "Stone grey", colour: "#cfcbc4" },
  { name: "Concrete", colour: "#a8a8a3" },
  { name: "Anthracite", colour: "#4a4b4d" },
  { name: "Terracotta", colour: "#c1704f" },
  { name: "Sage", colour: "#a8b59a" },
  { name: "Pale blue", colour: "#a9c9d6" },
  { name: "Sand", colour: "#e3d9c6" },
];

/**
 * A wall's or the roof's suggested colours (surfaces M2 hands-on): paints and claddings first, then the floor's (a wood
 * wall takes Oak, a tiled one Warm white).
 */
const WALL_SWATCHES: readonly { name: string; colour: string }[] = [
  { name: "White", colour: "#f2f0eb" },
  { name: "Off-white", colour: "#ebe5d9" },
  { name: "Charcoal", colour: "#3d4043" },
  { name: "Navy", colour: "#2f3e57" },
  { name: "Barn red", colour: "#8e3b2f" },
  { name: "Forest", colour: "#3f5a46" },
  ...SWATCHES,
];

const NONE = "none";

/**
 * The label whose finish the room shows (finishes.15), or null when it is this one: its own fields are editable. An
 * orphan label is its own.
 */
export function ownerOf(doc: Document, labelId: string): string | null {
  const zone = zoneOfLabel(doc, labelId);
  const first = zone ? firstLabelId(zone) : null;
  return first === null || first === labelId ? null : first;
}

/** A room label's finish fields in the Room section; a label whose room shows another's says where it is set. */
export function finishFields(doc: Document, labelId: string): Field[] {
  const owner = ownerOf(doc, labelId);
  if (owner !== null) return [field("Room", "floor", "Floor", `Set on ${doc.zoneLabels[owner]?.name ?? ""}`, null)];
  const tooFine = roomFinishes(doc).some((r) => r.id === labelId && r.geometry.tooFine);
  return floorFields("Room", "room", doc.zoneLabels[labelId]?.finish ?? null, tooFine);
}

/** A deck's finish fields in the Deck section (deck-floors.02). */
export function deckFinishFields(doc: Document, deckId: string): Field[] {
  const tooFine = deckFinishes(doc).some((d) => d.id === deckId && d.geometry.tooFine);
  return floorFields("Deck", "deck", deckView(doc, deckId)?.finish ?? null, tooFine);
}

/** Floor, then with a finish its Colour, Hex and numbers, and the too-fine note naming `what` it lies on. */
function floorFields(section: string, what: "room" | "deck", finish: Finish | null, tooFine: boolean): Field[] {
  const rows = finishRows(section, "", { id: "floor", label: "Floor" }, motifsFor("floor"), finish);
  return tooFine ? [...rows, { ...field(section, "finishNote", "Floor", `Pattern too fine for this ${what}`, null), check: "warning" as const }] : rows;
}

/** A finish's one-line summary: "<pattern> · <colour>", and "to 1.20 m" for a band, or "None" (inherit step 04). */
export function finishSummary(finish: Finish | null, band?: number, wall = true): string {
  if (!finish) return "None";
  const swatches = wall ? WALL_SWATCHES : SWATCHES;
  const name = swatches.find((c) => c.colour === finish.colour)?.name ?? finish.colour;
  const pattern = isMotifId(finish.motif) ? MOTIFS[finish.motif].name : finish.motif;
  return `${pattern} · ${name}${band === undefined ? "" : ` to ${shown(band)} m`}`;
}

/**
 * A finish's rows, for any surface (surfaces step 04, inherit step 04): first a summary row, id "row:" + `prefix` +
 * `main.id`, reading "<pattern> · <colour>" (and "to 1.20 m" for a band) or "None"; then, under it, the motif select
 * (`main`, labelled Pattern, None first, then `motifs`) and with a finish its Colour, Custom (a colour picker beside the
 * typed hex, id `hex`) and numbers, and a band's
 * Height. The fields under it carry its id in `inFinish`; the shell shows them only while it is open (AC-07). Each
 * id is `prefix` + its name, so two finishes can share a section list (a wall's sides: "left.finish", "left.colour"…).
 */
export function finishRows(section: string, prefix: string, main: { id: string; label: string; required?: true }, motifs: readonly MotifId[], finish: Finish | null, band?: { id: string; height: number }): Field[] {
  const group = `row:${prefix}${main.id}`;
  const under = (f: Field): Field => ({ ...f, inFinish: group });
  const swatches = motifs.some((m) => !MOTIFS[m].surfaces.includes("floor")) ? WALL_SWATCHES : SWATCHES; // a wall's or the roof's list
  const text = finishSummary(finish, band?.height, swatches === WALL_SWATCHES);
  const summary: Field = { ...field(section, group, main.label, text, null), finish: { colour: finish?.colour ?? null, motif: finish?.motif ?? null, open: false } };
  const options = [...(main.required ? [] : [{ value: NONE, label: "None" }]), ...motifs.map((m) => ({ value: m, label: MOTIFS[m].name }))]; // a custom side always has one (inherit.02)
  const select = { ...withOptions(field(section, `${prefix}${main.id}`, "Pattern", finish?.motif ?? NONE, null, false), options), select: true };
  if (!finish) return [summary, under(select)];
  const colours = swatches.map((s) => ({ value: s.colour, label: s.name }));
  const custom = colours.some((c) => c.value === finish.colour) ? [] : [{ value: finish.colour, label: `Custom ${finish.colour}` }];
  const picked: Field = { ...field(section, `${prefix}hex`, "Custom", finish.colour, null, false), colour: true }; // the picker beside the typed hex
  return [
    summary,
    ...[
      select,
      { ...withOptions(field(section, `${prefix}colour`, "Colour", finish.colour, null, false), [...colours, ...custom]), select: true },
      picked,
      ...(finish.motif === "plain" ? [] : numbers(section, prefix, finish)), // plain has no lines: strength, size and angle mean nothing
      ...(band ? [numberField(section, band.id, "Height", shown(band.height), "m", 0.05)] : []),
    ].map(under),
  ];
}

/** Sizes are whole millimetres, so they show with three decimals: a typed size reads back as typed ("0.025", "0.205"). */
const numbers = (section: string, prefix: string, f: Finish): Field[] => [
  numberField(section, `${prefix}strength`, "Strength", String(f.strength), "%", 1),
  numberField(section, `${prefix}size`, "Size", shown(f.size, 3), "m", 0.005),
  numberField(section, `${prefix}angle`, "Angle", String(f.angle), "°", 1),
];

/**
 * A finish field's command, or null for another field (or a label whose room shows another label's finish). Floor
 * follows the motif-change rule (finishes.37); the same motif sends the finish unchanged, which the domain takes as
 * no change.
 */
export function finishFieldCommand(doc: Document, labelId: string, fieldId: string, value: string): FieldCommand {
  if (ownerOf(doc, labelId) !== null) return null;
  return finishCommand(doc.zoneLabels[labelId]?.finish ?? null, "floor", fieldId, value, (finish) => ({ type: "setFinish", id: labelId, finish }));
}

/** A deck's finish field's command (deck-floors.02), or null for another field. */
export function deckFinishFieldCommand(doc: Document, deckId: string, fieldId: string, value: string): FieldCommand {
  return finishCommand(deckView(doc, deckId)?.finish ?? null, "floor", fieldId, value, (finish) => ({ type: "setDeckFinish", deckId, finish }));
}

/**
 * The command a finish field's `value` makes with `set`, from the finish `current`, for any surface: `mainId` is the
 * motif select's id ("floor", "finish"), the others are Colour, Hex and the numbers, ids without their prefix.
 */
export function finishCommand(current: Finish | null, mainId: string, fieldId: string, value: string, set: (finish: Finish | null) => Command): FieldCommand {
  if (fieldId === mainId) {
    if (value === NONE) return set(null);
    if (!isMotifId(value)) return null;
    return set(current?.motif === value ? current : withMotif(current, value));
  }
  if (!current) return null;
  const number = (key: "strength" | "size" | "angle"): FieldCommand => {
    const n = parseNumber(value);
    return Number.isFinite(n) ? set({ ...current, [key]: n }) : "notANumber";
  };
  switch (fieldId) {
    case "colour":
    case "hex":
      return set({ ...current, colour: value });
    case "strength":
    case "size":
    case "angle":
      return number(fieldId);
    default:
      return null;
  }
}
