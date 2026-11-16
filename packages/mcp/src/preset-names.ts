import { kindOf, OBJECT_KINDS, type Preset } from "@fm/domain";

// Preset names as Claude gives them (mcp step 06): a preset's word name where it has one ("King", "4 seats"), else its
// whole first size in cm ("170 × 70"), never a bare width, which reads like a whole size. The domain's ids stay as they
// are, since the editor's palette and Properties use them; this module maps one to the other.

const cm = (metres: number): number => Math.round(metres * 100);

/** The preset's name for Claude: its id when that is a word name, else its width and first depth in cm. */
export function presetName(p: Preset): string {
  if (p.id !== String(cm(p.w))) return p.id;
  const depth = Object.values(p.d)[0];
  return depth === undefined ? p.id : `${cm(p.w)} × ${cm(depth)}`;
}

/** A kind's preset names, in its presets' order. */
export function presetNamesOf(kind: string): string[] {
  return (kindOf(kind)?.presets ?? []).map(presetName);
}

/** Every kind's preset names, each once: the schema's enum. */
export const PRESET_NAMES: readonly string[] = [...new Set(OBJECT_KINDS.flatMap((k) => k.presets.map(presetName)))];

/** The preset of `kind` named `name`, or null. */
export function presetNamed(kind: string, name: string): Preset | null {
  return kindOf(kind)?.presets.find((p) => presetName(p) === name) ?? null;
}
