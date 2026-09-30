/**
 * Remembers the last call (spec §5.9, P3): the same result object while every argument is identical (===).
 * The function must read nothing but its arguments; keys are plain values or immutable documents.
 */
export function memoLast<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null;
  return (...args: A): R => {
    if (last !== null && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.result;
    const result = fn(...args);
    last = { args, result };
    return result;
  };
}

/** A set of IDs as one comparable key (IDs never contain a newline). */
export function idsKey(ids: readonly string[]): string {
  return [...ids].sort().join("\n");
}

export function idsOf(key: string): Set<string> {
  return new Set(key === "" ? [] : key.split("\n"));
}
