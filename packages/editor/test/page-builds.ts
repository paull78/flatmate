import type * as PagePlan from "../src/export/page-plan";

// Counts the pages actually drawn, for tests pinning when that happens: the ViewModel runs on every event.

const count = { builds: 0 };

export const pageBuilds = (): number => count.builds;
export function resetPageBuilds(): void {
  count.builds = 0;
}

export function counted(real: typeof PagePlan): typeof PagePlan {
  return {
    ...real,
    planPage: (...args) => {
      count.builds++;
      return real.planPage(...args);
    },
  };
}
