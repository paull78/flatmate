import type { EntityKey } from "@fm/protocol";
import type { Violation } from "./errors";
import { shown, toMm } from "./format";
import { distance } from "./geometry";
import { OPENING_KINDS, SHUTTER_BOX, dressingRefusal } from "./kinds";
import { openingLabel, type Document, type Opening } from "./model";
import { wallReach, type Reach } from "./queries/openings";
import { HEAD_CLEAR, MIN_OPENING_HEIGHT, wallRange, wallTopOver } from "./queries/vertical";

/** Openings closer than this to each other's reach, or past the wall's end by less, still count as touching. */
const OPENING_TOLERANCE = 1e-9;

const wallKey = (id: string): EntityKey => ({ table: "walls", id });

/**
 * I12 (spec: openings, openkinds.16, sills.02, .04): every opening is on an existing wall, and its reach (`wallReach`: its
 * span, and a pocket door's pocket) lies within the wall (from 0 to its length); it fits the wall's height (a sill from 0,
 * a door's or doorway's at 0, at least MIN_OPENING_HEIGHT tall, HEAD_CLEAR of wall above its head); and two openings on
 * one wall whose reaches overlap along it keep HEAD_CLEAR of wall between them in height, a pocket filling the wall up
 * to its door's head (touching along the wall is fine). A wall on a deck holds them too, from its deck's top (sills.03,
 * which lifted pillars.08). Messages name the
 * openings, and the pocket when it's the pocket that runs off the wall or meets another opening, with a plain sentence
 * for the toast where the composed one won't do.
 */
export function openingViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const v = (message: string, entities: EntityKey[]): void => void out.push({ invariant: "I12", message, entities });
  const key = (id: string): EntityKey => ({ table: "openings", id });
  const byWall = new Map<string, Opening[]>();
  for (const id of Object.keys(doc.openings).sort()) {
    const o = doc.openings[id];
    if (!o) continue;
    const wall = doc.walls[o.wall];
    const a = wall && doc.joints[wall.a];
    const b = wall && doc.joints[wall.b];
    if (!wall) {
      v(`${openingLabel(o.kind)} ${id} is on a missing wall`, [key(id)]);
      continue;
    }
    if (!a || !b) continue; // I1 reports the wall
    const range = wallRange(doc, wall.id);
    const top = wallTopOver(doc, wall.id, o.offset, o.offset + o.width); // under a slope, over its own span (roofs.17)
    const fit = range && top !== null ? fitError(o, top - range.bottom, wall.id) : null;
    if (fit) out.push({ invariant: "I12", ...fit, entities: [key(id), wallKey(wall.id)] });
    const length = distance(a, b);
    const reach = wallReach(o);
    if (!within({ from: o.offset, to: o.offset + o.width }, length)) {
      v(`${openingLabel(o.kind)} ${id} doesn't fit on wall ${wall.id}`, [key(id), wallKey(wall.id)]);
    } else if (!within(reach, length)) {
      const needs = `needs ${shown(o.width)} m of wall past its end`;
      out.push({ invariant: "I12", message: `${OPENING_KINDS[o.kind].label} ${id} ${needs}`, entities: [key(id), wallKey(wall.id)], plain: `A ${OPENING_KINDS[o.kind].label.toLowerCase()} ${needs}` });
    }
    byWall.set(wall.id, [...(byWall.get(wall.id) ?? []), o]);
  }
  for (const [wallId, list] of [...byWall].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const sorted = [...list].sort((p, q) => wallReach(p).from - wallReach(q).from || (p.id < q.id ? -1 : 1));
    sorted.forEach((p, i) => {
      for (const q of sorted.slice(i + 1)) {
        if (wallReach(p).to <= wallReach(q).from + OPENING_TOLERANCE) break; // sorted by start: no later one reaches back
        const gap = toMm(Math.max(p.sill, q.sill) - Math.min(p.head, q.head)); // mm of wall between them, negative when they overlap
        const lower = p.head <= q.head ? p : q;
        const clear = lower.shutterBox ? SHUTTER_BOX.height : HEAD_CLEAR; // a lower window's shutter box fills its height (hangings.04)
        if (gap < 0) out.push({ invariant: "I12", ...overlapMessage(p, q, wallId), entities: [key(p.id), key(q.id)] });
        else if (gap < toMm(clear)) out.push({ invariant: "I12", ...stackMessage(p, q, wallId, gap, clear), entities: [key(p.id), key(q.id)] });
      }
    });
  }
  return out;
}

/** "A door's", "A window's", "An opening's": the noun a plain sentence starts with. */
function possessive(o: Opening): string {
  const noun = openingLabel(o.kind).toLowerCase();
  return `${/^[aeiou]/.test(noun) ? "An" : "A"} ${noun}'s`;
}

/** Why `o` doesn't fit a wall `height` tall (sills.02), or null when it does; to the millimetre. */
function fitError(o: Opening, height: number, wallId: string): Pick<Violation, "message" | "plain"> | null {
  const name = `${openingLabel(o.kind)} ${o.id}`;
  if (OPENING_KINDS[o.kind].fromFloor && toMm(o.sill) !== 0) {
    return { message: `${name} has a sill of ${shown(o.sill)} m; a door or doorway starts at its wall's bottom`, plain: "A door or doorway starts at its wall's bottom" };
  }
  if (toMm(o.sill) < 0) return { message: `${name}'s sill is below wall ${wallId}'s bottom`, plain: `${possessive(o)} sill can't be below its wall's bottom` };
  if (toMm(o.head) - toMm(o.sill) < toMm(MIN_OPENING_HEIGHT)) {
    return { message: `${name} is ${shown(o.head - o.sill)} m tall; an opening must be at least ${shown(MIN_OPENING_HEIGHT)} m tall`, plain: `An opening must be at least ${shown(MIN_OPENING_HEIGHT)} m tall` };
  }
  if ((o.sheer !== undefined || o.shutterBox !== undefined) && !OPENING_KINDS[o.kind].dressings) {
    return { message: `${name} takes no sheer curtain or shutter box`, plain: dressingRefusal(o.kind) };
  }
  if (o.shutterBox && toMm(o.head) + toMm(SHUTTER_BOX.height) > toMm(height)) {
    return { message: `${name}'s shutter box needs ${shown(SHUTTER_BOX.height)} m of wall above its head, under wall ${wallId}'s top at ${shown(height)} m`, plain: `A shutter box needs ${shown(SHUTTER_BOX.height)} m of wall above the window's head` };
  }
  if (toMm(o.head) > toMm(height) - toMm(HEAD_CLEAR)) {
    return {
      message: `${name}'s head at ${shown(o.head)} m is less than ${shown(HEAD_CLEAR)} m under wall ${wallId}'s top at ${shown(height)} m`,
      plain: `${possessive(o)} head must be at least ${shown(HEAD_CLEAR)} m under its wall's top, at ${shown(height)} m`,
    };
  }
  return null;
}

/** Two openings sharing a stretch of wall with less than HEAD_CLEAR of wall between them in height (sills.04). */
function stackMessage(p: Opening, q: Opening, wallId: string, gapMm: number, clear: number): Pick<Violation, "message" | "plain"> {
  const between = `${shown(gapMm / 1000)} m apart in height`;
  return {
    message: `${openingLabel(q.kind)} ${q.id} and ${openingLabel(p.kind).toLowerCase()} ${p.id} on wall ${wallId} are ${between}; stacked openings keep ${shown(clear)} m of wall between them`,
    plain: `Stacked openings keep ${shown(clear)} m of wall between them`,
  };
}

function within(r: Reach, length: number): boolean {
  return r.from >= -OPENING_TOLERANCE && r.to <= length + OPENING_TOLERANCE;
}

/**
 * Why reaches `p` and `q` (in that order along the wall) overlap: their spans, or a pocket door's pocket, which also
 * gets a plain sentence for people (the editor's toast reads it, as for a wall on a deck).
 */
function overlapMessage(p: Opening, q: Opening, wallId: string): Pick<Violation, "message" | "plain"> {
  const spansMeet = p.offset + p.width > q.offset + OPENING_TOLERANCE && q.offset + q.width > p.offset + OPENING_TOLERANCE;
  if (spansMeet) return { message: `${openingLabel(q.kind)} ${q.id} overlaps ${openingLabel(p.kind).toLowerCase()} ${p.id} on wall ${wallId}` };
  const [pocket, other] = OPENING_KINDS[p.kind].pocket && wallReach(p).to > q.offset + OPENING_TOLERANCE ? [p, q] : [q, p];
  const door = OPENING_KINDS[pocket.kind].label.toLowerCase();
  return {
    message: `${openingLabel(other.kind)} ${other.id} overlaps ${door} ${pocket.id}'s pocket on wall ${wallId}`,
    plain: `A ${door}'s pocket would overlap a ${openingLabel(other.kind).toLowerCase()}`, // reads right from either side
  };
}
