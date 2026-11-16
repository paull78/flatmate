import { kindOf } from "@fm/domain";
import { isFurnitureSet } from "../furniture-sets";
import { PALETTE_KINDS } from "./palette";
import { PALETTE_ALIASES } from "./palette-aliases";

// Quick add (quick-add.02, .04, spec "Matching"): which palette kinds a typed query finds, best first. Every query word
// must match the kind by one of the tiers, best (lowest) first; a row's tier is its weakest word's, and rows sort by
// tier, then palette order. Pure: the web field renders the rows and arms the pick.

/** What the search knows about a kind: its label and group, the other names it answers to, its presets in metres. */
export type CatalogueEntry = { kind: string; label: string; group: string; aliases: readonly string[]; presets: readonly CataloguePreset[] };
/** A preset as the search sees it: its label (what the size picker shows and `pickPreset` takes) and its sizes in whole centimetres. */
export type CataloguePreset = { label: string; sizes: readonly number[] };
/** A range of the label to show in bold, in UTF-16 units of the label as shown. */
export type MatchRange = { start: number; end: number };
/**
 * One result: the kind, its label and group, the tier it matched at, the label's matched ranges, and a detail when the
 * match came from an alias ("(couch)") or a preset ("US Queen 162 × 213"), with the preset's label to arm.
 */
export type PaletteResult = { kind: string; label: string; group: string; tier: number; matched: readonly MatchRange[]; detail: string | null; preset: string | null };

/**
 * Tiers, best first (the spec's list): at each kind of match the label beats an alias, and an alias equal to the
 * whole query beats one with a word starting with it ("divano" is the sofa before the sofa bed's "divano letto").
 */
const LABEL = 1;
const LABEL_WORD = 2;
const ALIAS = 3;
const ALIAS_WORD = 4;
const PRESET = 5;
const INSIDE = 6;
const INSIDE_ALIAS = 7;
const TYPO = 8;
const TYPO_ALIAS = 9;
/** The shortest word that may sit inside another, and the shortest that may have one typo or two (quick-add.04). */
const INSIDE_FROM = 3;
const ONE_TYPO_FROM = 5;
const TWO_TYPOS_FROM = 9;

/** Text with case, accents and apostrophes gone and other punctuation as single spaces, and where each kept character came from. */
function normaliseMapped(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "'" || ch === "’") continue;
    const plain = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (/^[a-z0-9]+$/.test(plain)) {
      out += plain;
      for (let k = 0; k < plain.length; k++) from.push(i);
    } else if (out.length > 0 && !out.endsWith(" ")) {
      out += " ";
      from.push(i);
    }
  }
  const trimmed = out.endsWith(" ") ? out.slice(0, -1) : out;
  return { text: trimmed, from: from.slice(0, trimmed.length) };
}

/** A string as the search compares it: "Ship's ladder" → "ships ladder", "Sofà" → "sofa". */
export function normalise(text: string): string {
  return normaliseMapped(text).text;
}

/** A query's words: normalised, with a size's "×" or "x" between numbers as a space ("160x200" → "160 200"). */
function queryWords(query: string): string[] {
  const sized = query.replace(/(\d)\s*[x×*]\s*(?=\d)/gi, "$1 ");
  const text = normalise(sized);
  return text === "" ? [] : text.split(" ");
}

type Prepared = {
  entry: CatalogueEntry;
  index: number;
  label: string;
  from: number[];
  starts: number[];
  aliases: { text: string; words: string[] }[];
  presets: { label: string; words: string[]; sizes: readonly number[] }[];
};

function prepare(entry: CatalogueEntry, index: number): Prepared {
  const { text, from } = normaliseMapped(entry.label);
  const starts = [...text.matchAll(/\S+/g)].map((m) => m.index);
  const aliases = entry.aliases.map((a) => ({ text: a, words: normalise(a).split(" ") }));
  const presets = entry.presets.map((p) => ({ label: p.label, words: normalise(p.label).split(" ").filter((w) => !/^\d+$/.test(w)), sizes: p.sizes }));
  return { entry, index, label: text, from, starts, aliases, presets };
}

/** The label's range in the shown text for normalised positions [start, end). */
function shownRange(p: Prepared, start: number, end: number): MatchRange {
  return { start: p.from[start] ?? 0, end: (p.from[end - 1] ?? 0) + 1 };
}

type WordMatch = { tier: number; range: MatchRange | null; alias: string | null };

/** Optimal string alignment distance: changed, missing, extra or swapped (adjacent) characters, each one edit. */
export function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number): number => d[i]?.[j] ?? Infinity;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = d[i];
      if (row) row[j] = best;
    }
  }
  return at(a.length, b.length);
}

/** The typos a word may have: none under five characters, one from five, two from nine. */
const typosFor = (word: string): number => (word.length >= TWO_TYPOS_FROM ? 2 : word.length >= ONE_TYPO_FROM ? 1 : 0);

const isNumber = (word: string): boolean => /^\d+$/.test(word);

/** Whether a preset answers a word: a number equal to one of its sizes, or text starting a word of its label. */
function presetHas(preset: Prepared["presets"][number], word: string): boolean {
  return isNumber(word) ? preset.sizes.includes(Number(word)) : preset.words.some((w) => w.startsWith(word));
}

function matchWord(p: Prepared, word: string): WordMatch | null {
  if (isNumber(word)) return null; // numbers match presets only, never a label or an alias (quick-add.04)
  const at = p.starts.find((s) => p.label.startsWith(word, s));
  if (at !== undefined) return { tier: LABEL_WORD, range: shownRange(p, at, at + word.length), alias: null };
  const alias = p.aliases.find((a) => a.words.some((w) => w.startsWith(word)));
  if (alias) return { tier: ALIAS_WORD, range: null, alias: alias.text };
  return looseMatch(p, word);
}

/** A word inside a label or alias word (tier 5), or a few typos away from one (tier 6); neither for short words. */
function looseMatch(p: Prepared, word: string): WordMatch | null {
  const labelWords = p.label.split(" ");
  if (word.length >= INSIDE_FROM) {
    const inLabel = p.label.indexOf(word);
    if (inLabel >= 0) return { tier: INSIDE, range: shownRange(p, inLabel, inLabel + word.length), alias: null };
    const alias = p.aliases.find((a) => a.words.some((w) => w.includes(word)));
    if (alias) return { tier: INSIDE_ALIAS, range: null, alias: alias.text };
  }
  const typos = typosFor(word);
  if (typos === 0) return null;
  if (labelWords.some((w) => osaDistance(word, w) <= typos)) return { tier: TYPO, range: null, alias: null };
  const alias = p.aliases.find((a) => a.words.some((w) => osaDistance(word, w) <= typos));
  return alias ? { tier: TYPO_ALIAS, range: null, alias: alias.text } : null;
}

function score(p: Prepared, words: readonly string[]): PaletteResult | null {
  const { kind, label, group } = p.entry;
  const whole = words.join(" ");
  if (p.label.startsWith(whole)) return { kind, label, group, tier: LABEL, matched: [shownRange(p, 0, whole.length)], detail: null, preset: null };
  const named = p.aliases.find((a) => a.words.join(" ") === whole);
  if (named) return { kind, label, group, tier: ALIAS, matched: [], detail: `(${named.text})`, preset: null };
  const matches: WordMatch[] = [];
  const rest: string[] = []; // words left for a preset: one preset must answer all of them
  for (const word of words) {
    const m = matchWord(p, word);
    if (m) matches.push(m);
    else rest.push(word);
  }
  const preset = rest.length === 0 ? null : (p.presets.find((pr) => rest.every((w) => presetHas(pr, w))) ?? null);
  if (rest.length > 0 && !preset) return null;
  const alias = matches.find((m) => m.alias !== null)?.alias ?? null;
  const tier = Math.max(...matches.map((m) => m.tier), preset ? PRESET : 0);
  const matched = matches.flatMap((m) => (m.range ? [m.range] : []));
  const detail = preset ? preset.label : alias === null ? null : `(${alias})`;
  return { kind, label, group, tier, matched, detail, preset: preset ? preset.label : null };
}

const cm = (metres: number): number => Math.round(metres * 100);

/** A kind's presets with their widths and depths in centimetres (the domain's presets, smart.11). */
function presetsOf(kind: string): CataloguePreset[] {
  return (kindOf(kind)?.presets ?? []).map((p) => ({ label: p.label, sizes: [cm(p.w), ...Object.values(p.d).map(cm)] }));
}

/** The palette's kinds as the search sees them: labels, groups and order from `PALETTE_KINDS`, aliases from the table, presets from the domain. */
function paletteCatalogue(): CatalogueEntry[] {
  return PALETTE_KINDS.flatMap((g) => g.cards.map((c) => ({ kind: c.kind, label: c.name, group: g.group, aliases: PALETTE_ALIASES[c.kind] ?? [], presets: presetsOf(c.kind) })));
}

let defaultPrepared: Prepared[] | null = null;
const preparedFor = (catalogue: readonly CatalogueEntry[] | undefined): Prepared[] =>
  catalogue ? catalogue.map(prepare) : (defaultPrepared ??= paletteCatalogue().map(prepare));

/** The kinds `query` finds, best first; none for a blank query. `catalogue` defaults to the palette's. */
export function searchPalette(query: string, catalogue?: readonly CatalogueEntry[]): PaletteResult[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const scored = preparedFor(catalogue).flatMap((p) => {
    const r = score(p, words);
    return r ? [{ r, index: p.index }] : [];
  });
  // For one word a set follows the plain pieces (seated.06): "bed" still lists the beds first. Its name finds it at its tier.
  const set = (s: (typeof scored)[number]): number => (words.length === 1 && isFurnitureSet(s.r.kind) ? 1 : 0);
  return scored.sort((a, b) => set(a) - set(b) || a.r.tier - b.r.tier || a.index - b.index).map((s) => s.r);
}
