// How numbers are shown (cleanup.13): one rule for every metre, square metre and limit in the plan, Properties, tags,
// toasts and Claude's text. A value is rounded to a hundredth of its last shown digit first, which drops float noise
// (2.675 is stored as 2.67499…), then to the shown digits with halves away from zero: 2.675 reads "2.68" everywhere.
// Millimetres for geometry (`toMm`) round exactly instead.

/** `v` rounded half away from zero to whole units of 10^-digits, as an integer count of them. */
function units(v: number, digits: number): number {
  const fine = Math.round(Math.abs(v) * 10 ** (digits + 2)); // a hundredth of the last digit: the float noise goes
  return Math.sign(v) * Math.round(fine / 100);
}

/** A number as shown, with `digits` decimals (2 by default: centimetres for metres); never "-0.00" ((-0).toFixed does). */
export function shown(v: number, digits = 2): string {
  return (units(v, digits) / 10 ** digits).toFixed(digits);
}

/** The whole centimetre a metre value shows as: presets and pillows compare sizes as the fields show them (smart.17). */
export function shownCm(v: number): number {
  return units(v, 2) + 0; // + 0 turns -0 into 0
}

/**
 * Metres to the whole millimetre, exactly: geometry's one rule (stored values, the cut, levels). Stored values are
 * already whole millimetres, so the display's noise step would only move values sitting just under a half (cleanup.40).
 */
export function toMm(v: number): number {
  return Math.round(v * 1000) + 0; // + 0 turns -0 into 0
}

/** A limit in a message: two decimals under 10 m, whole metres from 10 up ("0.05", "2.00", "10"). */
export function metres(v: number): string {
  return v < 10 ? shown(v) : String(v);
}
