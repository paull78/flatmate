import { randomUUID } from "node:crypto";
import type { FontSpec, Host } from "@fm/editor";

/**
 * The editor's synchronous queries in Node (spec §5.2). This shell draws nothing, so text is measured with a
 * fixed-width estimate (0.6 × size per character, as in the fake shell); it only affects label hit-testing.
 */
export function createNodeHost(): Host {
  return {
    textMetrics: (text: string, font: FontSpec) => ({
      width: 0.6 * font.size * text.length,
      ascent: 0.8 * font.size,
      descent: 0.2 * font.size,
    }),
    now: () => performance.now(),
    newId: () => randomUUID(),
  };
}
