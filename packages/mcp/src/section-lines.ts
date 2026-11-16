import { sectionsOf, type Document } from "@fm/domain";

// A section in get_drawing and every edit's reply (section; AC-11): its letter, its line (the domain keeps it to the millimetre),
// the side it looks to in add_section's words, and how far it sees. At most 26 short rows, so they're listed whatever the
// region, in the listing and the overview alike.

export type SectionLine = { id: string; a: [number, number]; b: [number, number]; side: "left" | "right"; depth: number | null };

export function sectionLines(doc: Document): SectionLine[] {
  return sectionsOf(doc).map((s) => ({
    id: s.id,
    a: [s.a.x, s.a.y],
    b: [s.b.x, s.b.y],
    side: s.side === 1 ? "left" : "right",
    depth: s.depth,
  }));
}
