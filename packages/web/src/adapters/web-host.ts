import type { Host } from "@fm/editor";

/** Browser Host: synchronous queries only (spec: editor). Text is measured by the core's own tables (render.15). */
export function createWebHost(): Host {
  return {
    now: () => performance.now(),
    today: () => localDate(),
    newId: () => crypto.randomUUID(),
  };
}

/** The local calendar date as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
