import type { ReactNode } from "react";
import type { OpeningKind, ToolName } from "@fm/editor";
// The shell's icons (ux-polish item 7, decision ux-polish.08): inline SVG on a 20 px grid, 1.5 px strokes in the
// current text colour, no icon dependency. Paths follow the approved mockup.

const PATHS = {
  select: <path d="M5 3.5 15 9.5 10.5 10.8 8.6 15.5z" />,
  wall: (
    <>
      <path d="M3 7.5h14M3 12.5h14" />
      <path d="M3 7.5v5M17 7.5v5" opacity=".5" />
    </>
  ),
  zone: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" strokeDasharray="2.5 2" />
      <path d="M7 12.5h6" />
    </>
  ),
  object: (
    <>
      <rect x="3.5" y="5.5" width="13" height="10" rx="1.5" />
      <rect x="5.5" y="7" width="4" height="2.5" rx="1" />
      <rect x="10.5" y="7" width="4" height="2.5" rx="1" />
    </>
  ),
  opening: (
    <>
      <path d="M3 16.5h4M13 16.5h4M7 16.5V7" />
      <path d="M7 7a9.5 9.5 0 0 1 9.5 9.5" strokeDasharray="1.6 1.8" />
    </>
  ),
  dimension: (
    <>
      <path d="M3.5 4.5v9M16.5 4.5v9" opacity=".5" />
      <path d="M3.5 11h13M2 12.5l3-3M15 12.5l3-3" />
    </>
  ),
  deck: (
    <>
      <rect x="3" y="7" width="14" height="6" rx="1" />
      <path d="M3.5 14.5h13" strokeWidth="2.5" />
    </>
  ),
  hole: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <rect x="7" y="7" width="6" height="6" strokeDasharray="2 1.5" />
    </>
  ),
  column: (
    <>
      <path d="M3 10h3.5M13.5 10H17" opacity=".5" />
      <rect x="6.5" y="6.5" width="7" height="7" fill="currentColor" />
    </>
  ),
  scale: (
    <>
      <path d="M3 6.5v7M17 6.5v7" opacity=".5" />
      <path d="M3.5 10h13M6 7.5 3.5 10 6 12.5M14 7.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  swing: (
    <>
      <path d="M3 15.5h3M14 15.5h3M6 15.5V6.5" />
      <path d="M6 6.5a9 9 0 0 1 9 9" strokeDasharray="1.6 1.8" />
    </>
  ),
  double: (
    <>
      <path d="M2 15.5h2M16 15.5h2M4 15.5V9M16 15.5V9" />
      <path d="M4 9a6 6 0 0 1 6 6.5M16 9a6 6 0 0 0 -6 6.5" strokeDasharray="1.6 1.8" />
    </>
  ),
  sliding: <path d="M3 15.5h3M14 15.5h3M5.5 13h7M7.5 10.5h7" />,
  pocket: (
    <>
      <path d="M2 9.5h3M2 13.5h3M5 9.5v4M15 9.5h3M15 13.5h3" />
      <path d="M5 11.5h12" strokeDasharray="1.6 1.8" />
    </>
  ),
  folding: (
    <>
      <path d="M2 15.5h2M16 15.5h2M4 15.5l1.5-4 1.5 4 1.5-4 1.5 4" />
      <path d="M10 15.5h6" strokeDasharray="1.6 1.8" />
    </>
  ),
  slidingGlass: <path d="M2 11.5h2M16 11.5h2M4 10.5h7M9 12.5h7M4 9v5M16 9v5" />,
  passage: (
    <>
      <path d="M3 9.5h3M3 13.5h3M6 9.5v4M14 9.5h3M14 13.5h3M14 9.5v4" />
      <path d="M6 9.5h8M6 13.5h8" strokeDasharray="1.6 1.8" />
    </>
  ),
  curtain: (
    <>
      <path d="M2 9.5h3M15 9.5h3" />
      <path d="M5 12c1.25-1.5 1.25-1.5 2.5 0s1.25 1.5 2.5 0 1.25-1.5 2.5 0 1.25 1.5 2.5 0" />
    </>
  ),
  window: <path d="M3 13.5h14M3 9.5h14M3 9.5v4M17 9.5v4M3 11.5h14" />,
  casement: (
    <>
      <path d="M3 13.5h14M3 15.5h14M3 13.5v2M17 13.5v2M5 13.5V4" />
      <path d="M5 4a10 10 0 0 1 10 9.5" strokeDasharray="1.6 1.8" />
    </>
  ),
  twoLeaf: (
    <>
      <path d="M3 13.5h14M3 15.5h14M3 13.5v2M17 13.5v2M4.5 13.5V8M15.5 13.5V8" />
      <path d="M4.5 8a5.5 5.5 0 0 1 5.5 5.5M15.5 8a5.5 5.5 0 0 0 -5.5 5.5" strokeDasharray="1.6 1.8" />
    </>
  ),
  undo: (
    <>
      <path d="M7.5 6 4 9.5 7.5 13" />
      <path d="M4 9.5h7.5a4.5 4.5 0 0 1 0 9H9" />
    </>
  ),
  redo: (
    <>
      <path d="M12.5 6 16 9.5 12.5 13" />
      <path d="M16 9.5H8.5a4.5 4.5 0 0 0 0 9H11" />
    </>
  ),
  section: <path d="M2.5 6h4M13.5 6h4M8.25 6h3.5M4.5 6v8.5M15.5 6v8.5M2.5 12l2 2.5 2-2.5M13.5 12l2 2.5 2-2.5" />,
  chevron: <path d="M6 8l4 4 4-4" />,
  export: (
    <>
      <path d="M10 3.5v9" />
      <path d="M6.5 9 10 12.5 13.5 9" />
      <path d="M4 14.5v2h12v-2" />
    </>
  ),
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  plus: <path d="M10 3.75v12.5M3.75 10h12.5" />,
  copy: (
    <>
      <rect x="6.75" y="6.75" width="10" height="10" rx="1.75" />
      <path d="M13.25 6.75V5a1.75 1.75 0 0 0-1.75-1.75H5A1.75 1.75 0 0 0 3.25 5v6.5A1.75 1.75 0 0 0 5 13.25h1.75" />
    </>
  ),
  trash: <path d="M3.25 5.5h13.5M7.5 5.5V3.75a.6.6 0 0 1 .6-.6h3.8a.6.6 0 0 1 .6.6V5.5M5 5.5l.9 10.75a.6.6 0 0 0 .6.5h7a.6.6 0 0 0 .6-.5L15 5.5" />,
  tick: <path d="M4.5 10.5 8 14l7.5-8" />,
  warning: (
    <>
      <path d="M10 3.5 17.5 16.5h-15z" />
      <path d="M10 8.5v3.5M10 14.25v.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

/** A 20 × 20 icon drawn at `size` px (a section chevron is drawn smaller); decorative, so hidden from assistive tech. */
/** Each opening kind's icon: a total map, so a kind added to the domain's table fails to compile until it has one. */
export const OPENING_ICONS: Record<OpeningKind, IconName> = { swing: "swing", double: "double", sliding: "sliding", pocket: "pocket", folding: "folding", slidingGlass: "slidingGlass", window: "window", casement: "casement", twoLeaf: "twoLeaf", passage: "passage", curtain: "curtain" };

/** Each tool's icon: a total map, so a new tool fails to compile until it has one. */
export const TOOL_ICONS: Record<ToolName, IconName> = { select: "select", wall: "wall", zone: "zone", object: "object", opening: "opening", dimension: "dimension", column: "column", deck: "deck", hole: "hole", section: "section", scale: "scale" };

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

// The palette rail's group icons (library.03): the approved mockup's paths on a 24 px grid, drawn at 22 px so their
// strokes weigh about the same as the floating bar's.
const GROUP_PATHS: Readonly<Record<string, ReactNode>> = {
  Sleep: (
    <>
      <rect x="4" y="9" width="16" height="9" rx="1.5" />
      <path d="M4 18v2M20 18v2M7 9V6.5A1.5 1.5 0 0 1 8.5 5h7A1.5 1.5 0 0 1 17 6.5V9" />
    </>
  ),
  "Sit and eat": (
    <>
      <path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
      <rect x="3" y="11" width="18" height="5" rx="2" />
      <path d="M6 16v3M18 16v3" />
    </>
  ),
  Work: (
    <>
      <rect x="4" y="5" width="16" height="10" rx="1" />
      <path d="M9 19h6M12 15v4" />
    </>
  ),
  Kitchen: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="9" r="2" />
      <circle cx="9" cy="15" r="2" />
      <circle cx="15" cy="15" r="2" />
    </>
  ),
  Bathroom: (
    <>
      <path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M6 12V6a2 2 0 0 1 4 0" />
    </>
  ),
  Storage: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M12 3v18M10 12h0M14 12h0" />
    </>
  ),
  Sets: (
    <>
      <rect x="7" y="4" width="10" height="13" rx="1" />
      <rect x="3" y="4" width="3" height="3" />
      <rect x="18" y="4" width="3" height="3" />
    </>
  ),
  Basic: <rect x="5" y="5" width="14" height="14" rx="1" />,
  Stairs: <path d="M4 20h4v-4h4v-4h4V8h4V4" />,
  Floors: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 12h16M12 4v8M8 12v8M16 12v8" />
    </>
  ),
};

/** A palette group's rail icon (Basic's square for a group without one); decorative, so hidden from assistive tech. */
export function GroupIcon({ group }: { group: string }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GROUP_PATHS[group] ?? GROUP_PATHS.Basic}
    </svg>
  );
}
