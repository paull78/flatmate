import { shown, toMm } from "@fm/domain";

// Typed values (spec typed-input, feet): what a typed number can be, which keys a value field takes, and how the hint
// line shows one. Numbers with optional units, joined by operators; no unit means metres; a unit is only a scale, in
// metres per unit, with no checking of dimensions. A length in feet and inches (8'6", 8ft 6in, 8'-6") is one number
// (feet.06). Only float noise is taken off a result; commands round to whole millimetres as they always have.

/** Whether a field's value takes units: fields in metres do; one in degrees, percent or a plain count doesn't. */
export type ValueUnits = "metres" | "plain";

const MAX_TEXT = 200; // keeps the recursion's depth bounded; no real value is near it
const NOISE = 1e9; // far under a millimetre, far over a float's error at room scale
const NUMBER = /\d+(?:[.,]\d*)?|[.,]\d+/y;
const LETTERS = /[a-z]+/iy;
const FOOT = 0.3048;
const INCH = 0.0254;
/** Metres per unit: exact for a foot and an inch, which a divisor isn't. */
const UNITS: ReadonlyMap<string, number> = new Map([["m", 1], ["cm", 0.01], ["mm", 0.001], ["ft", FOOT], ["in", INCH], ["'", FOOT], ['"', INCH]]);

/** The number a typed text means, or null when it can't be read. */
export function readValue(text: string, units: ValueUnits): number | null {
  if (text.length > MAX_TEXT) return null;
  const source = text.replaceAll("−", "-").replaceAll("×", "*").replaceAll("′", "'").replaceAll("″", '"');
  let at = 0;

  const skipSpaces = (): void => {
    while (source[at] === " ") at += 1;
  };
  const next = (): string | undefined => {
    skipSpaces();
    return source[at];
  };
  const match = (pattern: RegExp): string | null => {
    pattern.lastIndex = at;
    const found = pattern.exec(source)?.[0];
    if (found === undefined) return null;
    at += found.length;
    return found;
  };

  /** A number and its unit in metres per unit (1 with none), or null when it isn't one. */
  const measure = (): { value: number; scale: number; unit: string | null } | null => {
    const digits = match(NUMBER);
    if (digits === null) return null;
    skipSpaces();
    const mark = source[at] === "'" || source[at] === '"' ? source[at] : null;
    if (mark !== null) at += 1;
    const unit = mark ?? match(LETTERS)?.toLowerCase() ?? null;
    const scale = unit === null ? 1 : UNITS.get(unit);
    if (scale === undefined || (unit !== null && units === "plain")) return null;
    return { value: Number(digits.replace(",", ".")), scale, unit };
  };

  /** After a length in feet, its inches: marked, worded or bare, after an optional drafting dash (feet.03); else nothing. */
  const inches = (): number => {
    const from = at;
    if (next() === "-") at += 1;
    skipSpaces();
    const part = measure();
    if (part !== null && (part.unit === null || part.scale === INCH)) return part.value;
    at = from;
    return 0;
  };

  const number = (): number | null => {
    const m = measure();
    if (m === null) return null;
    return m.scale === FOOT ? m.value * FOOT + inches() * INCH : m.value * m.scale;
  };

  const factor = (): number | null => {
    if (next() === "-") {
      at += 1;
      const inner = bare();
      return inner === null ? null : -inner;
    }
    return bare();
  };

  const bare = (): number | null => {
    if (next() !== "(") return number();
    at += 1;
    const inner = sum();
    if (inner === null || next() !== ")") return null;
    at += 1;
    return inner;
  };

  const product = (): number | null => {
    let left = factor();
    for (let op = next(); left !== null && (op === "*" || op === "/"); op = next()) {
      at += 1;
      const right = factor();
      if (right === null || (op === "/" && right === 0)) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };

  const sum = (): number | null => {
    let left = product();
    for (let op = next(); left !== null && (op === "+" || op === "-"); op = next()) {
      at += 1;
      const right = product();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const value = sum();
  if (value === null || next() !== undefined) return null;
  const clean = Math.round(value * NOISE) / NOISE; // 0.1+0.2 isn't 0.3 in floats, and "whole millimetres" checks are exact
  return Number.isFinite(clean) ? clean + 0 : null; // + 0 turns -0 into 0
}

/**
 * What a key adds to an open value field, or null for a key the field doesn't take, which goes on to the tools and the
 * shortcuts. A unit letter or mark counts only after a digit, spaces aside, so `M` and `C` still pick their tools otherwise;
 * `t` only after `f` and `n` only after `i` (ft, in).
 */
export function valueChar(value: string, key: string): string | null {
  if (/^[0-9.,+\-*/]$/.test(key)) return key;
  if (key === " ") return value === "" ? null : key;
  const afterNumber = /[0-9.,] *$/.test(value);
  if (key === "'" || key === '"') return afterNumber ? key : null; // a foot or an inch mark (spec feet)
  const letter = key.toLowerCase();
  if (letter === "c" || letter === "f" || letter === "i") return afterNumber ? letter : null;
  if (letter === "m") return /[0-9.,] *[cm]?$/.test(value) ? letter : null;
  if (letter === "t") return /[0-9.,] *f$/.test(value) ? letter : null;
  if (letter === "n") return /[0-9.,] *i$/.test(value) ? letter : null;
  return null;
}

/** A value field's text after a key: what the key types, or Backspace trimmed; null for a key that isn't its own. */
export function editedValue(value: string, key: string): string | null {
  if (key === "Backspace") return value.slice(0, -1);
  const char = valueChar(value, key);
  return char === null ? null : value + char;
}

/** The toast for a text that can't be read. */
export function cantRead(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "Enter a number" : `Can't read ${trimmed}`;
}

/** The hint line's text for a typed value: as typed; with its result when it's a sum or has a unit; no unit if unreadable. */
export function typedLine(typed: string): { value: string; unit: "m" | null } {
  if (/^(?:\d+[.,]?\d*|[.,]\d+)? *$/.test(typed)) return { value: typed.trimEnd(), unit: "m" };
  const result = readValue(typed, "metres");
  if (result === null) return { value: typed, unit: null };
  return { value: `${typed.trimEnd()} = ${toMm(result) % 10 === 0 ? shown(result) : shown(result, 3)}`, unit: "m" };
}
