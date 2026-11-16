import type { Document, EntityRef } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { wallsTarget } from "./run-drag";
import type { DragTarget } from "./types";

// What a press on a selected entity drags, moved out of select-tool.ts (straight step 04, straight.25).

/** The drag a press on `ref` starts, or null when it doesn't drag. */
export function dragTarget(doc: Document, ref: EntityRef): DragTarget | null {
  switch (ref.table) {
    case "joints":
      return { kind: "joint", jointId: ref.id };
    case "walls": // a column moves as one piece (pillars.13)
      return doc.walls[ref.id]?.column ? { kind: "column", wallId: ref.id } : wallsTarget(doc, ref.id);
    case "zoneLabels":
      return null; // zone selection does not move walls (spec: tools)
    case "decks":
      return { kind: "deck", deckId: ref.id }; // pressed only when selected (press)
    case "placements":
      return { kind: "placement", placementId: ref.id };
    case "openings":
      return { kind: "opening", openingId: ref.id };
    case "dimensions":
      return { kind: "dimension", dimensionId: ref.id };
    case "deckHoles":
      return { kind: "hole", holeId: ref.id }; // pressed only when selected (press)
    case "states":
    case "objects":
    case "projectFields":
    case "underlays":
    case "logos":
    case "ceilings":
    case "sheets":
    case "areas":
      return { kind: "area", areaId: ref.id }; // pressed only when selected alone (press)
    case "sections":
      return null; // states, objects, project fields, the underlay, the logo, the ceiling and sheets are not on the canvas; a section's line doesn't drag
    default:
      return assertNever(ref.table);
  }
}
