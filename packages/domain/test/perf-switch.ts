import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    perf: boolean;
  }
}

/** Whether speed budgets run: FM_PERF=1, provided by vitest.shared.ts (snags.07). Timing tests sit in `describe.skipIf(!PERF)`. */
export const PERF = inject("perf") === true;
