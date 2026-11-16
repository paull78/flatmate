import { deepEqual, type EntityKey } from "@fm/protocol";
import { stairRuleOf } from "./kinds";
import { isLinked, sharedOf } from "./linked";
import { MIN_WINDER_EXTRA } from "./stairs";
import { MESSAGES, type Violation } from "./errors";
import type { Document, LayoutObject } from "./model";
import { stairRise } from "./queries/stairs";
import { surfaceTop } from "./queries/vertical";

// I19, a stair's link and a linked object's copies (stairs.10, .18, review.05), beside validate.ts as decks.ts holds I18: `reaches` names an existing
// deck, and a linked stair's height in every configuration is that deck's top less the surface of each of its
// placements; a stair has one placement in every state, all equal in pose, surface, sides and zones (the configuration
// may differ). `startsAt` names an existing deck whose top is below the stair's top (stairs.49). The row parser
// already keeps both off furniture.

/** Heights agree to half a millimetre; both sides are stored to the millimetre. */
const HEIGHT_EPS = 0.0005;

export function stairViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.objects).sort()) {
    const object = doc.objects[id];
    if (object && isLinked(object)) out.push(...copyViolations(doc, object));
    if (object && stairRuleOf(object.kind) !== null) out.push(...startViolations(doc, object));
    if (object && stairRuleOf(object.kind)?.shape === "winder" && Object.keys(object.d).some((c) => (object.d[c] ?? 0) < (object.w[c] ?? 0) + MIN_WINDER_EXTRA - HEIGHT_EPS)) {
      out.push({ invariant: "I19", message: MESSAGES.winderDepth, entities: [{ table: "objects", id }] });
    }
    const reaches = object?.reaches;
    if (!object || typeof reaches !== "string") continue;
    const entities: EntityKey[] = [{ table: "objects", id }];
    if (!Object.hasOwn(doc.decks, reaches)) {
      out.push({ invariant: "I19", message: `${object.name} reaches deck ${reaches}, which doesn't exist`, entities });
      continue;
    }
    for (const p of Object.values(doc.placements)) {
      if (p.object !== id) continue;
      const rise = stairRise(doc, reaches, p.deck);
      if (Object.values(object.h).some((h) => Math.abs(h - rise) > HEIGHT_EPS)) {
        out.push({ invariant: "I19", message: `${object.name}'s height must reach ${doc.decks[reaches]?.name ?? "its deck"}`, entities: [...entities, { table: "placements", id: p.id }] });
      }
    }
  }
  return out;
}

/** A start deck that doesn't exist, or whose top isn't below the stair's top on every copy and configuration. */
function startViolations(doc: Document, object: LayoutObject): Violation[] {
  const start = object.startsAt;
  if (typeof start !== "string") return [];
  const entities: EntityKey[] = [{ table: "objects", id: object.id }];
  if (!Object.hasOwn(doc.decks, start)) return [{ invariant: "I19", message: `${object.name} starts at deck ${start}, which doesn't exist`, entities }];
  const low = Object.values(doc.placements).some((p) => p.object === object.id && Object.values(object.h).some((h) => surfaceTop(doc, p.deck) + h <= surfaceTop(doc, start) + HEIGHT_EPS));
  return low ? [{ invariant: "I19", message: `${object.name} must rise above ${doc.decks[start]?.name ?? "the deck it starts at"}`, entities }] : [];
}

/** A linked object missing in a state, placed twice in one, or with copies that differ in what they share (review.05). */
function copyViolations(doc: Document, object: LayoutObject): Violation[] {
  const copies = Object.values(doc.placements).filter((p) => p.object === object.id);
  const entities: EntityKey[] = [{ table: "objects", id: object.id }];
  const states = Object.keys(doc.states);
  if (copies.length !== states.length || states.some((s) => !copies.some((c) => c.state === s))) {
    return [{ invariant: "I19", message: `${object.name} must stand in every layout, once`, entities }];
  }
  const [first, ...rest] = copies;
  const same = (p: (typeof copies)[number]): boolean => first !== undefined && deepEqual(sharedOf(object, p), sharedOf(object, first));
  return rest.every(same) ? [] : [{ invariant: "I19", message: `${object.name} must stand in the same place in every layout`, entities }];
}
