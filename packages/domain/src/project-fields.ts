// The title block's project fields (sheet.02, .03, .05): a fixed list, one row per set field keyed by the field's key.
// Every fact about a field lives here (labels included, as kinds.ts does for objects); the editor and MCP derive theirs.

import { PAPER_NAMES, SCALE_REFUSAL, SHEET_SCALES, type Document, type PaperName } from "./model";
import { AXLES_REFUSAL, HITCH_REFUSAL, TONGUE_BOX_REFUSAL, TRAILER_AXLES, TRAILER_HITCHES } from "./trailer";

// blank: what an empty field means, for a form to say (a date of issue prints today's).
type ProjectFieldInfo = { key: string; label: string; maxLength: number; multiline: boolean; check?: (value: string) => string | null; blank?: string };

const line = (key: string, label: string): ProjectFieldInfo => ({ key, label, maxLength: 80, multiline: false });

/** In title block order. */
export const PROJECT_FIELDS: readonly ProjectFieldInfo[] = [
  line("subtitle", "Subtitle"),
  line("address", "Address"),
  line("client", "Client"),
  line("number", "Project number"),
  line("phase", "Phase"),
  line("revision", "Revision"),
  line("revisionDate", "Revision date"),
  line("author", "Author"),
  { key: "notes", label: "Notes", maxLength: 500, multiline: true },
];

const setting = (key: string, label: string, check: (value: string) => string | null): ProjectFieldInfo => ({ key, label, maxLength: 80, multiline: false, check });

/** The studio's details and the date of issue (sheetset.18): typed in Project in Properties, printed by the column in places of their own. */
export const STUDIO_FIELDS: readonly ProjectFieldInfo[] = [
  { ...line("issueDate", "Date of issue"), blank: "Today" },
  line("studioName", "Studio name"),
  line("studioAddress", "Studio address"),
  line("studioContact", "Studio contact"),
];

/** What the 3D view shows around the house, as stored and as a menu names it (surroundings.05). None is no row (surroundings.15), so it isn't listed. */
export const SURROUNDINGS_VALUES = [
  { value: "interior", label: "Interior" },
  { value: "outside", label: "Outside" },
  { value: "wheels", label: "On wheels" },
  { value: "grid", label: "Grid" },
] as const;
export type Surroundings = (typeof SURROUNDINGS_VALUES)[number]["value"];

/**
 * The sheet set's settings (sheetset.21): stored and undone like the fields above, but a list of their own, since the
 * title block prints the first list and Properties and MCP read it, and "PAPER A3" must print from neither. Surroundings
 * is no sheet setting, but it wants the same: saved with the project and printed nowhere (surroundings.05).
 */
export const SET_FIELDS: readonly ProjectFieldInfo[] = [
  setting("paper", "Paper", (v) => (PAPER_NAMES.some((p) => p === v) ? null : "Paper must be A4, A3, A2, A1 or Letter")),
  setting("generalScale", "General scale", (v) => (SHEET_SCALES.some((s) => String(s) === v) ? null : SCALE_REFUSAL)),
  setting("north", "North", (v) => (/^(0|[1-9]\d{0,2})$/.test(v) && Number(v) < 360 ? null : "North must be a whole number of degrees from 0 to 359")),
  // One canonical spelling, as a swatch is found by comparing strings and the value reaches PDF and SVG as it stands.
  setting("accent", "Accent", (v) => (/^#[0-9a-f]{6}$/.test(v) ? null : "Accent must be a colour like #b3261e")),
  setting("surroundings", "Surroundings", (v) => (SURROUNDINGS_VALUES.some((s) => s.value === v) ? null : "Surroundings must be interior, outside, wheels or grid; empty means None")),
  // The trailer on wheels (trailer.03): read as one value by trailerOf; empty is the default, as None is for Surroundings.
  setting("trailerHitch", "Hitch", (v) => (TRAILER_HITCHES.some((h) => h === v) ? null : HITCH_REFUSAL)),
  setting("trailerAxles", "Axles", (v) => (TRAILER_AXLES.some((n) => String(n) === v) ? null : AXLES_REFUSAL)),
  setting("tongueBox", "Tongue box", (v) => (v === "on" ? null : TONGUE_BOX_REFUSAL)),
  ...STUDIO_FIELDS,
];

export function projectFieldOf(key: string): ProjectFieldInfo | null {
  return PROJECT_FIELDS.find((f) => f.key === key) ?? SET_FIELDS.find((f) => f.key === key) ?? null;
}

/** The set's paper; a project that never chose one prints on A4. */
export function sheetSetPaper(doc: Document): PaperName {
  return PAPER_NAMES.find((p) => p === doc.projectFields["paper"]?.value) ?? "A4";
}

/** The set's general scale, the N of 1:N; a project that never chose one fits the drawing to the paper. */
export function sheetSetScale(doc: Document): number | "fit" {
  return SHEET_SCALES.find((s) => String(s) === doc.projectFields["generalScale"]?.value) ?? "fit";
}

/** The project's north, in whole degrees clockwise from up on the plan; a project that never set one prints no arrow (AC-10). */
export function sheetSetNorth(doc: Document): number | null {
  const value = doc.projectFields["north"]?.value;
  return value === undefined ? null : Number(value);
}

/** The set's accent as "#rrggbb"; null when a project never chose one, and the printing side has its own default. */
export function sheetSetAccent(doc: Document): string | null {
  return doc.projectFields["accent"]?.value ?? null;
}

/** The date of issue as typed; null when blank, which prints today's (sheetset.18). */
export function sheetSetIssueDate(doc: Document): string | null {
  return doc.projectFields["issueDate"]?.value ?? null;
}

/** The project's surroundings; null is None, which a project that never chose one reads as. */
export function surroundingsOf(doc: Document): Surroundings | null {
  return SURROUNDINGS_VALUES.find((s) => s.value === doc.projectFields["surroundings"]?.value)?.value ?? null;
}

/** Why a non-empty value can't be stored in this field, or null when it can. */
export function projectFieldProblem(field: ProjectFieldInfo, value: string): string | null {
  // An untyped caller can pass anything; setProjectField doesn't revalidate, so check before reading its length (tidy C8).
  if (typeof value !== "string") return `${field.label} must be text`;
  if (value.length > field.maxLength) return `${field.label} is longer than ${field.maxLength} characters`;
  if (!field.multiline && /[\r\n]/.test(value)) return `${field.label} must be one line`;
  return field.check?.(value) ?? null;
}
