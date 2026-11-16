import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { add, rotateAbout } from "../geometry";
import { configsOf, isObjectSize, stairRuleOf } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { diffPatch } from "../patch";
import { roundMm, sizeOf } from "../queries/footprints";
import { squareSize } from "../queries/stairs";
import { isValidId } from "../shape";
import { finish, key, placementsOf } from "./object-helpers";
import type { CommandOf, CommandResult, ResizeSide } from "./types";

/**
 * One side grip's resize (AC-02): a width side sets the width of every configuration (smart.05), a depth side the
 * depth of the placement's configuration; only this placement's anchor moves, so the opposite side stays where it was
 * in this layout (within the millimetre rounding). Other placements keep their anchor, the middle of the back edge
 * (layout-states.49), as setObjectSize does. Fit is checked once, in every layout, so a break in another layout or
 * another configuration is refused and named (AC-03). An unchanged shown size is a no-op even when stored widths
 * differ: the drag's zero move relies on it.
 */
export function resizePlacement(doc: Document, cmd: CommandOf<"resizePlacement">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const size = p ? sizeOf(doc, p) : null;
  if (!p || !object || !size) return err(domainError("notFound", "Placement not found"));
  if (!isObjectSize(cmd.size)) return err(domainError("invalidInput", MESSAGES.objectSize));
  // The object's size and every placement of it (a concurrent move elsewhere must conflict), and the layout.
  const deps: EntityKey[] = [
    key("objects", object.id), ...placementsOf(doc, object.id).map((id) => key("placements", id)), key("states", p.state),
  ];
  const asked = { w: widthSide(cmd.side) ? cmd.size : size.w, d: widthSide(cmd.side) ? size.d : cmd.size };
  const square = squareSize(stairRuleOf(object.kind), size, asked); // a spiral's box stays square (stairs.21)
  const [w, d] = square === null ? [asked.w, asked.d] : [square, square];
  if (w === size.w && d === size.d) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const at = resizedAnchor(p, cmd.side, size.w, size.d, cmd.size);
  const widths = { ...object, w: Object.fromEntries(configsOf(object).map((c) => [c.id, w])) };
  const resized: LayoutObject = square !== null ? { ...widths, d: { ...object.d, [p.config]: d } } : widthSide(cmd.side) ? widths : { ...object, d: { ...object.d, [p.config]: d } };
  const next: Document = {
    ...doc,
    objects: { ...doc.objects, [object.id]: resized },
    placements: { ...doc.placements, [p.id]: { ...p, at } },
  };
  return finish(doc, next, deps);
}

/**
 * The anchor of a placement whose `side` is resized to `size` from its current w × d, so the opposite side stays put:
 * the side's shift in placement coordinates (footprintQuad: x from −w/2 to w/2, y from −d to 0), turned with it and
 * rounded per axis to the millimetre. The one anchor rule for a resize: the command stores it, the editor previews it.
 */
export function resizedAnchor(p: Pick<Placement, "at" | "rotation">, side: ResizeSide, w: number, d: number, size: number): Point {
  const dw = widthSide(side) ? size - w : 0;
  const dd = widthSide(side) ? 0 : size - d;
  const turned = rotateAbout(add(p.at, shiftOf(side, dw, dd)), p.at, p.rotation);
  return { x: roundMm(turned.x), y: roundMm(turned.y) };
}

function widthSide(side: ResizeSide): boolean {
  switch (side) {
    case "left":
    case "right": return true;
    case "front":
    case "back": return false;
    default: return assertNever(side);
  }
}

/** Where the anchor moves so the side opposite `side` stays put, given the growth in width and depth. */
function shiftOf(side: ResizeSide, dw: number, dd: number): Point {
  switch (side) {
    case "right": return { x: dw / 2, y: 0 };
    case "left": return { x: -dw / 2, y: 0 };
    case "front": return { x: 0, y: 0 }; // the anchor is on the back edge, which stays
    case "back": return { x: 0, y: dd };
    default: return assertNever(side);
  }
}
