// Shortcut labels per platform (cleanup.09): the editor's view model names keys neutrally ("Mod+Z", "Delete"), and
// the shell draws them as the platform does, ⌘Z and ⌫ on a Mac, Ctrl+Z and Del elsewhere.

/** Whether a platform or user agent string is Apple's (macOS, iPad, iPhone). */
export function isMac(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

/** This browser's platform, read once; false where there is no navigator (tests in Node pass `mac` themselves). */
export const IS_MAC: boolean = typeof navigator !== "undefined" && isMac(navigator.platform || navigator.userAgent);

const MAC: Readonly<Record<string, string>> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Delete: "⌫" };
const OTHER: Readonly<Record<string, string>> = { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Delete: "Del" };

/** The modifiers in each platform's order: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere. */
const MAC_ORDER = ["Alt", "Shift", "Mod"];
const OTHER_ORDER = ["Mod", "Alt", "Shift"];

/** A neutral key ("Shift+Mod+Z", "Delete", "W") as the platform shows it; an unknown modifier passes through. */
export function keyLabel(key: string, mac: boolean): string {
  const [names, order] = mac ? [MAC, MAC_ORDER] : [OTHER, OTHER_ORDER];
  const parts = key.split("+");
  const last = parts.pop() ?? "";
  const rank = (p: string): number => (order.includes(p) ? order.indexOf(p) : order.length);
  const mods = [...parts].sort((a, b) => rank(a) - rank(b));
  return mods.map((p) => names[p] ?? `${p}+`).join("") + (names[last] ?? last).replace(/\+$/, "");
}
