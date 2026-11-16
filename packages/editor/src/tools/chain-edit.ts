import { execute, wallChain, wallFace, wallHelperDimension, type Command, type Document, type Level, roundMm } from "@fm/domain";

const mm = roundMm; // typed values and float noise stay out of the document: the one millimetre rule (cleanup.39)

/** Corrections at most: each pass lands within a fraction of the last error, so two or three are usual. */
const CLEAR_PASSES = 8;

/**
 * The command typing `value` into a wall's total gives (ux-polish.35): the clear length of its room-side face after
 * the move, keeping joint a; null when the wall is missing. The first guess is value + both face insets as they are now;
 * moving the joint can tilt a neighbouring wall, which moves the inner corner, so the guess is corrected by what the
 * clear length measures on the document it produces until it reads `value` to the millimetre (tidy.45). A refused
 * trial returns the first guess, so the domain's refusal still shows.
 */
export function clearLengthCommand(doc: Document, wallId: string, value: number): Command | null {
  const face = wallFace(doc, wallId);
  const h = wallHelperDimension(doc, wallId);
  if (!face || !h) return null;
  const command = (length: number): Command => ({ type: "setWallLength", wallId, length: mm(length), keep: "a" });
  const first = command(value + face.faceStart + (h.length - face.faceEnd));
  let length = value + face.faceStart + (h.length - face.faceEnd);
  for (let pass = 0; pass < CLEAR_PASSES; pass++) {
    const tried = execute(doc, command(length));
    const after = tried.ok ? wallFace(tried.value.doc, wallId) : null;
    if (!after) return pass === 0 ? first : command(length);
    const error = value - (after.faceEnd - after.faceStart);
    if (Math.abs(error) < CLEAR_TOLERANCE) return command(length);
    length += error;
  }
  return command(length);
}

/** Half a millimetre: within it the clear length shows the typed value. */
const CLEAR_TOLERANCE = 0.0005;

/**
 * The one command typing `value` into chain piece `index` of a wall gives (ux-polish item 4), or null when the wall
 * has no such piece:
 * - the end piece at the face's start moves its opening: offset = faceStart + value;
 * - an opening's piece sets its width; the a-side edge (the offset) stays, as the wall length keeps joint a;
 * - a gap between two openings moves the one on the b side: offset = left opening's end + value;
 * - the end piece at the face's end moves its opening: offset = faceEnd − value − width.
 */
export function chainCommand(doc: Document, wallId: string, index: number, value: number, level: Level): Command | null {
  const chain = wallChain(doc, wallId, level); // the pieces the viewed level's chain shows (review.09)
  const piece = chain?.pieces[index];
  if (!chain || !piece) return null;
  const { left, right } = piece;
  if (piece.role === "opening") return left.kind === "opening" ? { type: "setOpening", openingId: left.id, width: mm(value) } : null;
  // A gap starts at the face's start or at the end of the opening on its a side.
  if (right.kind === "opening") return { type: "moveOpening", openingId: right.id, offset: mm(piece.start + value) };
  const o = left.kind === "opening" ? doc.openings[left.id] : undefined;
  return o ? { type: "moveOpening", openingId: o.id, offset: mm(chain.faceEnd - value - o.width) } : null; // face to face: no opening
}
