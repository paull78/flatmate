import { deckView, dimensionPoints, footprints, holeView, openingGeometry, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import { armSpot, ellOutline } from "../snapping/arm-drag";
import { sideOf } from "../snapping/resize";
import { deckSide } from "../tools/deck-edit";
import { holeSide } from "../tools/hole-edit";
import { sectionFarSpot } from "../tools/section-edit";
import { zoneFrame } from "../snapping/zone-drag";
import type { EditorState } from "../state";
import type { DragTarget } from "../tools/types";
import type { Handle } from "./handles";
import type { ViewModel } from "./view-model-types";

// The canvas cursor shows what a press would do (furnish.10, spec: editor): crosshair in the drawing tools, pointer in
// the Zone tool; in Select, by the handle under the pointer, the entity under it, or the drag in progress.

type Cursor = ViewModel["cursor"];
type ResizeCursor = "ew-resize" | "ns-resize" | "nesw-resize" | "nwse-resize";
const RESIZE: readonly ResizeCursor[] = ["ew-resize", "nesw-resize", "ns-resize", "nwse-resize"];

/**
 * The resize cursor nearest a world direction, in 45° steps. World y points up and the camera only flips y, so a
 * world up-right direction is screen up-right, which CSS calls nesw.
 */
export function resizeCursor(dir: Point): ResizeCursor {
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  const k = ((Math.round(deg / 45) % 4) + 4) % 4;
  return RESIZE[k] ?? "ew-resize";
}

export function cursorFor(state: EditorState): Cursor {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
    case "object":
    case "opening":
    case "dimension":
    case "column":
    case "deck":
    case "hole":
    case "section":
    case "scale":
      return "crosshair";
    case "zone": // draws a named area (areas.41); the Floor mode clicks a floor
      return tool.state.motif === null ? "crosshair" : "pointer";
    case "select": {
      const s = tool.state;
      if (s.kind === "box" && s.corner) return "crosshair";
      if (s.kind === "moving") return dragCursor(s.baseDoc, s.target);
      // Grips show only while idle or pressing (gripsShown), so a handle's cursor too.
      if ((s.kind === "idle" || s.kind === "pressing") && state.hoverHandle) return handleCursor(state.hoverHandle);
      return hoverCursor(state);
    }
    default:
      return assertNever(tool);
  }
}

function handleCursor(h: Handle): Cursor {
  switch (h.kind) {
    case "joint":
    case "sectionEnd":
      return "move";
    case "side":
    case "armGrip":
    case "sectionFar":
      return resizeCursor(h.normal);
    case "rotate":
      return "grab";
    case "zoneDepth":
      return resizeCursor(h.normal);
    case "zoneEnd":
      return resizeCursor(h.along);
    case "deckSide":
    case "holeSide":
    case "areaSide":
      return resizeCursor(h.normal);
    default:
      return assertNever(h);
  }
}

/** A drag keeps the cursor of what it moves: grips and handles never show while moving. */
function dragCursor(doc: Document, target: DragTarget): Cursor {
  switch (target.kind) {
    case "joint":
    case "walls":
    case "placement":
    case "placements":
    case "sectionEnd":
      return "move";
    case "resize": {
      const quad = footprints(doc).get(target.placementId);
      const side = quad ? sideOf(quad, target.side) : null;
      return side ? resizeCursor(side.normal) : "move";
    }
    case "holeSide": {
      const hole = holeView(doc, target.holeId)?.hole;
      const side = hole ? holeSide(hole, target.side) : null;
      return side ? resizeCursor(side.normal) : "move";
    }
    case "armGrip": {
      const outline = ellOutline(doc, target.placementId);
      const spot = outline ? armSpot(outline, target.arm) : null;
      return spot ? resizeCursor(spot.normal) : "move";
    }
    case "rotate":
      return "grabbing";
    case "opening":
      return openingCursor(doc, target.openingId) ?? "move";
    case "dimension":
      return dimensionCursor(doc, target.dimensionId) ?? "move";
    case "zoneDepth": {
      const f = zoneFrame(doc, target.placementId, target.side, target.strip);
      return f ? resizeCursor(f.normal) : "move";
    }
    case "zoneEnd": {
      const f = zoneFrame(doc, target.placementId, target.side, target.strip);
      return f ? resizeCursor(f.along) : "move";
    }
    case "deck":
    case "hole":
    case "area":
    case "column":
      return "move";
    case "areaSide":
      return resizeCursor(target.side === "right" || target.side === "left" ? { x: 1, y: 0 } : { x: 0, y: 1 });
    case "deckSide": {
      const deck = deckView(doc, target.deckId);
      const side = deck ? deckSide(deck, target.side) : null;
      return side ? resizeCursor(side.normal) : "move";
    }
    case "sectionFar": {
      const row = doc.sections[target.sectionId];
      const spot = row ? sectionFarSpot(row, 1) : null;
      return spot ? resizeCursor(spot.normal) : "move";
    }
    default:
      return assertNever(target);
  }
}

function hoverCursor(state: EditorState): Cursor {
  const ref: EntityRef | null = state.hover;
  if (!ref) return "default";
  const doc = state.document ? visibleDoc(state.document) : null;
  switch (ref.table) {
    case "joints":
    case "walls":
      return "move";
    case "openings":
      return (doc && openingCursor(doc, ref.id)) ?? "pointer";
    case "dimensions":
      return (doc && dimensionCursor(doc, ref.id)) ?? "pointer";
    case "decks": // a selected deck drags; another one is selected by a click
      return state.selection.some((r) => r.table === "decks" && r.id === ref.id) ? "move" : "pointer";
    case "placements":
    case "deckHoles": // as a deck: a selected hole drags, another one is selected by a click
      return state.selection.some((r) => r.table === "deckHoles" && r.id === ref.id) ? "move" : "pointer";
    case "zoneLabels":
    case "states":
    case "objects":
    case "projectFields":
    case "underlays":
    case "logos":
    case "ceilings":
    case "sheets":
    case "sections":
    case "areas":
      return "pointer";
    default:
      return assertNever(ref.table);
  }
}

/** An opening slides along its wall. */
function openingCursor(doc: Document, id: string): ResizeCursor | null {
  const g = openingGeometry(doc, id);
  return g ? resizeCursor(g.along) : null;
}

/** A placed dimension's offset moves across its line. */
function dimensionCursor(doc: Document, id: string): ResizeCursor | null {
  const row = doc.dimensions[id];
  const ends = row ? dimensionPoints(doc, row) : null;
  return ends ? resizeCursor({ x: -(ends.b.y - ends.a.y), y: ends.b.x - ends.a.x }) : null;
}
