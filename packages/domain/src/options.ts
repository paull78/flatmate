import { isRecord } from "@fm/protocol";

// Per-object options (library.10): a kind lists the options it takes (its `options` column), an object stores the ones
// that are on in `options` as `true` keys, the field absent when none is on and never `{}`, so two clients' rows can't
// differ. A flat record, since wire entities hold primitives or flat objects only (spec: collaboration). This module imports
// nothing from the domain: kinds.ts, model.ts and shape.ts all read it.

/** Every option. */
export const OBJECT_OPTIONS = ["computer", "roundChairs", "leftEntry", "hooks"] as const;
export type ObjectOption = (typeof OBJECT_OPTIONS)[number];

export const isObjectOption = (v: unknown): v is ObjectOption => OBJECT_OPTIONS.some((o) => o === v);

/** The refusal when an object's kind doesn't list the option. */
export const OPTION_REFUSALS: Readonly<Record<ObjectOption, string>> = {
  computer: "Only a desk takes a computer",
  roundChairs: "Only a chair, or a table or desk with chairs, takes round chairs",
  leftEntry: "Only a winder stair is entered from the left", // steps.04: it only redraws
  hooks: "Only a rung ladder takes hooks", // steps.05: drawn only
};

/** The options an object has on: a key per option, always `true`; never empty (the field is absent instead). */
export type ObjectOptions = Partial<Record<ObjectOption, true>>;

/** Whether the object has the option on; false for none. */
export const hasOption = (object: { options?: ObjectOptions } | undefined, option: ObjectOption): boolean => object?.options?.[option] === true;

/** A copy of `object` with the option on or off; the field goes with the last option. */
export function withOption<T extends { options?: ObjectOptions }>(object: T, option: ObjectOption, on: boolean): T {
  const options: ObjectOptions = {};
  for (const o of OBJECT_OPTIONS) if (o === option ? on : hasOption(object, o)) options[o] = true;
  return Object.keys(options).length === 0 ? withoutOptions(object) : { ...object, options };
}

/** A copy of `object` with no option on (a kind switch drops them all). */
export function withoutOptions<T extends { options?: ObjectOptions }>(object: T): T {
  const next = { ...object };
  delete next.options;
  return next;
}

/** A stored `options` value: a non-empty record whose keys are options the kind lists, each `true`, as a fresh object; or null. */
export function parseOptions(v: unknown, listed: readonly ObjectOption[]): ObjectOptions | null {
  if (!isRecord(v)) return null;
  const out: ObjectOptions = {};
  for (const [k, on] of Object.entries(v)) {
    if (!isObjectOption(k) || !listed.includes(k) || on !== true) return null;
    out[k] = true;
  }
  return Object.keys(out).length === 0 ? null : out;
}
