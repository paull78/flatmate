// Which Properties sections are open (inherit step 06, AC-08): the minor ones start closed, and a section opened or
// closed stays so after a reload, in this browser only (localStorage, keyed by the section's title). A blocked or empty
// storage falls back to the defaults.

const KEY = "fm-sections";
/** The sections closed until opened: what a person rarely changes while drawing (the mock, inherit.03). */
export const CLOSED_BY_DEFAULT: ReadonlySet<string> = new Set(["Shortcuts", "Underlay", "Trailer", "Project"]);

export type SectionStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function browserStore(): SectionStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function saved(store: SectionStore | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === "boolean"));
  } catch {
    return {};
  }
}

/** Whether the section titled `title` shows open. */
export function sectionOpen(title: string, store: SectionStore | null = browserStore()): boolean {
  return saved(store)[title] ?? !CLOSED_BY_DEFAULT.has(title);
}

/**
 * Remembers the section as opened or closed, keeping only what differs from its default: a section that opens as it
 * mounts fires a toggle too, and that mustn't pin today's default. Nothing happens when storage is blocked.
 */
export function rememberSection(title: string, open: boolean, store: SectionStore | null = browserStore()): void {
  try {
    const { [title]: _was, ...rest } = saved(store);
    void _was;
    store?.setItem(KEY, JSON.stringify(open === !CLOSED_BY_DEFAULT.has(title) ? rest : { ...rest, [title]: open }));
  } catch {
    // storage full or blocked: the section still toggles, it just isn't remembered
  }
}
