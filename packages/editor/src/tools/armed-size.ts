import { defaultSize, heightsOf, isObjectHeight, isObjectSize, kindConfigs, kindOf, lowerable, presetOf, presetSize, roundMm, shown, shownCm, type ObjectSizes, type Preset } from "@fm/domain";
import type { ArmedEntry, EditorState, SizeDraft } from "../state";
import { readValue } from "../typed-value";
import type { ViewModel } from "../view/view-model-types";

// The armed size while placing (furnish.05, sizing.19, spec: layouts): one entry per kind id for the session, its preset
// picked by label in the hint line and the width, depth and height typed over it; the ghost, its fit and the click
// read it here and nowhere else.

type Field = "width" | "depth" | "height";
const FIELDS: readonly Field[] = ["width", "depth", "height"];

/** Whether `kind` takes a typed size now: the armed kind, known, not a stair, while no set is armed (sizing.11 b). */
function takesSize(state: EditorState, kind: string): boolean {
  return state.objectSet === null && kind === state.objectKind && kindOf(kind)?.stair === null;
}

/** Whether an entry holds a typed size over its preset. */
function typed(entry: ArmedEntry | undefined): boolean {
  return entry?.w !== undefined || entry?.d !== undefined || entry?.h !== undefined;
}

/** The preset an entry stands on: the one with its label, else the one matching the kind's default (smart.17); null for a kind without presets. */
function presetFor(kind: string, label: string | null | undefined): Preset | null {
  const k = kindOf(kind);
  const size = defaultSize(kind);
  if (!k || !size || k.presets.length === 0) return null;
  return k.presets.find((p) => p.label === label) ?? presetOf({ kind, ...size }) ?? null;
}

/**
 * The preset the Object tool places for the armed kind: the one picked this session, or else the one matching the
 * kind's default size; null for a kind without presets. A typed size keeps it for what it doesn't type (the open
 * depth, the elevation, the height where none is typed).
 */
export function armedPreset(state: EditorState): Preset | null {
  return presetFor(state.objectKind, state.armed[state.objectKind]?.preset);
}

/** An entry's sizes for `kind`: its preset's (else the kind's defaults), the typed width and height over every configuration and the typed depth over the first (smart.05, furnish.04). */
function entrySize(kind: string, entry: ArmedEntry | undefined): ObjectSizes | null {
  const preset = presetFor(kind, entry?.preset);
  const base = preset ? presetSize(kind, preset.id) : defaultSize(kind);
  const configs = kindConfigs(kind);
  const first = configs[0];
  if (!base || !first) return null;
  const every = (v: number | undefined, from: Readonly<Record<string, number>>) => (v === undefined ? from : Object.fromEntries(configs.map((c) => [c.id, v])));
  const d = entry?.d;
  return { ...base, w: every(entry?.w, base.w), h: every(entry?.h, base.h), d: d === undefined ? base.d : { ...base.d, [first.id]: d } };
}

/** The preset whose whole size (width, depth and height per configuration) an armed size equals to the shown centimetre; null for none. */
function sameAsPreset(kind: string, sizes: ObjectSizes): Preset | null {
  const same = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, c: string) => a[c] !== undefined && b[c] !== undefined && shownCm(a[c]) === shownCm(b[c]);
  const configs = kindConfigs(kind).map((c) => c.id);
  return kindOf(kind)?.presets.find((p) => {
    const ps = presetSize(kind, p.id);
    return ps !== null && configs.every((c) => same(ps.w, sizes.w, c) && same(ps.d, sizes.d, c) && same(ps.h, sizes.h, c));
  }) ?? null;
}

/** The sizes the Object tool places for the armed kind: its armed preset's, heights included (catalog.07), with the typed sizes over them. */
export function armedSize(state: EditorState): ObjectSizes | null {
  return entrySize(state.objectKind, state.armed[state.objectKind]);
}

/** Whether the armed kind's size is typed: the click then sends it, and the list reads Custom. */
export function armedTyped(state: EditorState): boolean {
  return typed(state.armed[state.objectKind]);
}

/** The armed kind's typed height, or null where none is typed (sizing.15). */
export function typedHeight(state: EditorState): number | null {
  return state.armed[state.objectKind]?.h ?? null;
}

/** The hint line's picker: only in the Object tool with a kind that has presets; each option's d is the first configuration's depth. */
export function sizePickerView(state: EditorState): ViewModel["sizePicker"] {
  const armed = state.tool.name === "object" && state.objectSet === null ? armedPreset(state) : null;
  const kind = kindOf(state.objectKind);
  const first = kindConfigs(state.objectKind)[0];
  if (!armed || !kind || !first) return null;
  const options = kind.presets.map((p) => ({ label: p.label, w: p.w, d: p.d[first.id] ?? first.d }));
  return { kind: kind.id, current: armedTyped(state) ? "Custom" : armed.label, options };
}

/** The hint line's Width, Depth and Height: the armed size, or a field's text that didn't read, listed in `bad`; Height only for a kind that may be lowered; null where no size can be typed. */
export function sizeFieldsView(state: EditorState): ViewModel["sizeFields"] {
  const kind = state.objectKind;
  const first = kindConfigs(kind)[0];
  const size = state.tool.name === "object" && takesSize(state, kind) ? armedSize(state) : null;
  if (!size || !first) return null;
  const draft = state.sizeDraft?.kind === kind ? state.sizeDraft : null;
  const bad = FIELDS.filter((f) => draft?.[f] !== undefined);
  const height = lowerable(kind) ? (draft?.height ?? shown(heightsOf(size, first.id)?.h ?? 0)) : null;
  return { kind, width: draft?.width ?? shown(size.w[first.id] ?? 0), depth: draft?.depth ?? shown(size.d[first.id] ?? 0), height, bad };
}

/** A pick from the picker: kept for the kind when the label is one of its presets, else the state itself; it replaces a typed size and clears a bad text (sizing.20). Never an edit. */
export function pickPreset(state: EditorState, kind: string, label: string): EditorState {
  const k = kindOf(kind); // a plain search: "constructor" and "__proto__" find nothing
  if (!k?.presets.some((p) => p.label === label)) return state;
  return { ...state, armed: { ...state.armed, [k.id]: { preset: label } }, sizeDraft: null };
}

/** A field's text read as metres to the millimetre, or null when it isn't a number or breaks `valid`. */
function readMm(text: string, valid: (v: number) => boolean): number | null {
  const v = readValue(text, "metres");
  return v !== null && valid(roundMm(v)) ? roundMm(v) : null;
}

/**
 * The hint line's typed width, depth and height for the armed kind (sizing.06, .15): a field that reads sets that
 * size; one that doesn't keeps its text in the draft and changes nothing, with no toast (sizing.23). A height is taken
 * only for a kind that may be lowered (0.01 to 10 m), and ignored for others. A size equal to a preset's whole size to
 * the shown centimetre becomes that preset, so one entry answers the list, the fields and the click. Ignored for a set
 * and a stair kind. Never an edit.
 */
export function setArmedSize(state: EditorState, kind: string, given: Partial<Record<Field, string>>): EditorState {
  if (!takesSize(state, kind)) return state;
  const texts = lowerable(kind) ? given : { ...(given.width === undefined ? {} : { width: given.width }), ...(given.depth === undefined ? {} : { depth: given.depth }) };
  if (FIELDS.every((f) => texts[f] === undefined)) return state;
  const valid = (f: Field) => (f === "height" ? isObjectHeight : isObjectSize);
  const read = (f: Field): number | null => {
    const t = texts[f];
    return t === undefined ? null : readMm(t, valid(f));
  };
  const old = state.armed[kind];
  const draft = state.sizeDraft?.kind === kind ? state.sizeDraft : null;
  const textOf = (f: Field): string | undefined => {
    const t = texts[f];
    return t === undefined ? draft?.[f] : read(f) === null ? t : undefined;
  };
  const w = read("width") ?? old?.w;
  const d = read("depth") ?? old?.d;
  const h = read("height") ?? old?.h;
  const entry: ArmedEntry = { preset: old?.preset ?? null, ...(w === undefined ? {} : { w }), ...(d === undefined ? {} : { d }), ...(h === undefined ? {} : { h }) };
  const sizes = typed(entry) ? entrySize(kind, entry) : null;
  const preset = sizes ? sameAsPreset(kind, sizes) : null;
  const next: ArmedEntry = preset ? { preset: preset.label } : entry;
  const width = textOf("width");
  const depth = textOf("depth");
  const height = textOf("height");
  const kept = { ...(width === undefined ? {} : { width }), ...(depth === undefined ? {} : { depth }), ...(height === undefined ? {} : { height }) };
  const nextDraft: SizeDraft | null = Object.keys(kept).length === 0 ? null : { kind, ...kept };
  const armed = typed(entry) || old !== undefined ? { ...state.armed, [kind]: next } : state.armed;
  return { ...state, armed, sizeDraft: nextDraft };
}
