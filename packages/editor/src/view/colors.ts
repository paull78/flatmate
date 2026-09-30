// One palette for every renderer. Light theme.
// Hex only (#rrggbb or #rrggbbaa): renderers and tests compare these values.
// Keep background equal to --fm-bg in packages/web/src/styles.css.
export const COLORS = {
  background: "#f4f4f2", // light warm grey canvas
  grid: "#e7e7e3",
  gridMajor: "#d8d8d3",
  wall: "#1d1d1f", // near-black walls
  wallSelected: "#2563eb", // blue selection
  wallHover: "#4b4b50",
  preview: "#2563eb99", // translucent blue preview
  invalid: "#e5484d", // red invalid preview and ghost
  handle: "#ffffff",
  handleFixed: "#2563eb",
  snap: "#d97706",
  snapGuide: "#d9770680", // translucent snap orange: the line an aligned point lines up along
  zoneFill: "#dce8f7aa", // soft blue floor
  zoneFillSelected: "#b9d0f2cc",
  zoneHint: "#2563eb1f", // faint unlabelled-room hint while Z is active
  text: "#1d1d1f",
  textMuted: "#6b6b6b", // same grey as DEFAULT_ME_COLOR in state.ts
  helper: "#0f766e", // teal: distinct from the selection blue, so helper text is easy to tell apart (and to filter in tests)
} as const;
