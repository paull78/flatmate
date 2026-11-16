// What every package's vitest config shares (snags.07, .12), held there by `scripts/test/test-rules.test.ts`. Speed is
// judged apart from correctness: tests that read the wall clock sit in `describe.skipIf(!PERF)` blocks, switched on by
// FM_PERF=1 (as the browser perf runs are) and run at every gate on a quiet machine. Every test and hook gets 30 s,
// so a correctness test that only runs slowly under load doesn't fail on time; a test may set a longer limit, never a
// shorter one (snags.20).

/** True when the speed budgets should run. */
export const PERF = process.env["FM_PERF"] === "1";

/** The `test` options every package's vitest config spreads. */
export const sharedTest = { provide: { perf: PERF }, testTimeout: 30_000, hookTimeout: 30_000 };
