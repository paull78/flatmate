import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { defaultSize, kindConfigs } from "../src/kinds";
import { inConvex } from "../src/geometry";
import { CEILING_ID, EPS, type Document } from "../src/model";
import { deckViews } from "../src/queries/decks";
import { footprintFit } from "../src/queries/fit";
import { tuckRole } from "../src/queries/tucks";
import { footprintQuad, quadCentre, roundMm } from "../src/queries/footprints";
import { landing, type LandingCandidate } from "../src/queries/landing";
import { levelOf, levels, type Level } from "../src/queries/levels";
import { heightsOf, type Heights } from "../src/queries/vertical";
import { placedPiece } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { place, rng, tinyHouse, withDeck } from "./helpers";

// The landing agreement fuzz (decks.11, levels.08, .16, spec "Architecture", "Placing at a level"): for random pieces,
// positions, current surfaces and viewed levels, `landing` answers the first candidate that fits in the order current,
// then the level's (at the floor the floor and the deck under the centre among the decks below its cut; at an upper
// level the deck under the centre among its own), or the first candidate when none fits, or "none" at an upper level
// with none of its decks under the centre; and the command that stores a surface answer is accepted exactly when
// footprintFit says the piece fits there. Deck moves and resizes run in the same stream and change the document under
// later draws; an accepted pure move must carry every piece on the deck by its delta.
//
// The tiny house under a 3.20 m ceiling (so a chair fits on the loft): a solid platform (0.45) at x 2.2–3.8, y 0.4–2.0 and a loft (2.15) at
// x 4.2–6.6, y 0.8–2.4; a coffee table on the platform, a desk under the loft and a coffee table on it in Layout, a
// coffee table on the loft and a chair on the floor at Night.

declare const console: { log(message: string): void };

const KINDS = ["chair", "coffeeTable", "desk", "wardrobe", "block"] as const;

function start(): Document {
  let doc: Document = { ...tinyHouse(), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.2 } } };
  doc = withDeck(doc, { id: "plat", name: "Platform", at: [3, 1.2], w: 1.6, d: 1.6, top: 0.45, solid: true });
  doc = withDeck(doc, { id: "loft", name: "Loft", at: [5.4, 1.6], w: 2.4, d: 1.6, top: 2.15, solid: false });
  doc = place(doc, { object: "ct", kind: "coffeeTable", at: [3, 2], deck: "plat" });
  doc = place(doc, { object: "desk", kind: "desk", at: [5.4, 2.4] });
  doc = place(doc, { object: "low", kind: "coffeeTable", at: [5.4, 1.4], state: "Night", deck: "loft" });
  doc = place(doc, { object: "side", kind: "coffeeTable", at: [5.8, 2.4], deck: "loft" });
  return place(doc, { object: "chair", kind: "chair", at: [6.5, 0.6], state: "Night" });
}

const sameLevel = (a: Level, b: Level): boolean => Math.round(a.height * 1000) === Math.round(b.height * 1000);

/**
 * The oracle the answer is checked against: the candidates in the rule's order, deduplicated, and the level's own
 * (the floor and the deck under the centre among the decks whose level is the floor; an upper level's deck under it).
 */
function candidates(doc: Document, c: LandingCandidate, level: Level): { order: (string | null)[]; own: (string | null)[] } {
  const mine = deckViews(doc).filter((v) => sameLevel(levelOf(doc, v.id), level) && c.centre !== null && inConvex(c.centre, v.ring, EPS));
  const top = Math.max(...mine.map((v) => v.top));
  const under = mine.find((v) => v.top === top)?.id ?? null; // by ID, so a tie keeps the lower one
  const own = level.height === 0 ? [null, under] : under === null ? [] : [under];
  const all = [...(c.current === undefined ? [] : [c.current]), ...own];
  return { order: all.filter((s, i) => all.indexOf(s) === i), own };
}

describe("the landing agreement fuzz (decks.11)", () => {
  it("landing answers the first candidate that fits, its command agrees with footprintFit, and deck moves carry", () => {
    const random = rng(20261020);
    const pick = <T,>(xs: readonly T[]): T => {
      const x = xs[Math.floor(random() * xs.length)];
      if (x === undefined) throw new Error("empty");
      return x;
    };
    const cm = (lo: number, hi: number): number => Math.round((lo + (hi - lo) * random()) * 100) / 100;
    const seen = new Map<string, number>();
    const count = (k: string): void => void seen.set(k, (seen.get(k) ?? 0) + 1);
    const failures: string[] = [];
    let doc = start();
    expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
    expect(levels(doc).map((l) => [l.height, l.deckIds])).toEqual([[0, []], [2.15, ["loft"]]]);

    /**
     * Checks one candidate viewed at the level of `viewed` (a deck's ID or null) and the command storing its answer;
     * returns the command's result document, if accepted.
     */
    const check = (tag: string, c: LandingCandidate, viewed: string | null, cmd: (surface: string | null) => Command): Document | null => {
      const level = levelOf(doc, viewed);
      const name = level.height === 0 ? "floor level" : "upper level";
      const landed = landing(doc, c, level);
      const { order, own } = candidates(doc, c, level);
      const fitting = order.filter((s) => footprintFit(doc, c.ring, c.state, c.heights, s, c.ignore, c.centre, undefined, c.tuck, c.parts).fits);
      const expected = fitting.length > 0 ? fitting[0] : own.length === 0 ? "none" : order[0];
      const answer = landed.kind === "surface" ? landed.deck : "none";
      if (answer !== expected) failures.push(`${tag} at ${level.height}: landed ${answer}, expected ${expected} of ${JSON.stringify(order)}`);
      if (landed.kind === "none") {
        // Only at an upper level with none of its decks under the centre.
        if (level.height === 0 || own.length > 0) failures.push(`${tag} at ${level.height}: none with ${JSON.stringify(own)}`);
        count(`no surface at the ${name}`);
        return null;
      }
      const s = landed.deck;
      // A surface is the current one, the floor at the floor level, or a deck of the level.
      const ofLevel = s === null ? level.height === 0 : sameLevel(levelOf(doc, s), level);
      if (s !== c.current && !ofLevel) failures.push(`${tag} at ${level.height}: ${s} is neither current nor the level's`);
      if (s !== null && s === c.current && !sameLevel(levelOf(doc, s), level)) count("current at another level");
      const fits = footprintFit(doc, c.ring, c.state, c.heights, s, c.ignore, c.centre, undefined, c.tuck, c.parts).fits;
      const r = execute(doc, cmd(s));
      if (r.ok !== fits) failures.push(`${tag}: footprintFit ${fits}, command ${r.ok} on ${s}`);
      count(`${fits ? "fits" : "none"} ${s === null ? "floor" : s === c.current ? "current" : "deck"}`);
      count(`${fits ? "fits" : "none"} at the ${name}`);
      return r.ok ? r.value.doc : null;
    };

    for (let n = 0; n < 3000; n++) {
      const roll = random();
      if (roll < 0.15) {
        // A deck move or a resize (a side grip's centre and size, or a typed size).
        const deckId = pick(["plat", "loft"]);
        const deck = doc.decks[deckId];
        if (!deck) throw new Error("no deck");
        const move = random() < 0.6;
        const cmd: Command = move
          ? { type: "setDeck", deckId, at: { x: roundMm(deck.at.x + cm(-0.3, 0.3)), y: roundMm(deck.at.y + cm(-0.3, 0.3)) } }
          : { type: "setDeck", deckId, at: { x: roundMm(deck.at.x + cm(-0.15, 0.15)), y: deck.at.y }, w: roundMm(deck.w + pick([-0.3, -0.2, -0.1, 0.1, 0.2, 0.3])), d: deck.d };
        const r = execute(doc, cmd);
        count(`${move ? "deck move" : "deck resize"} ${r.ok ? "ok" : "refused"}`);
        if (!r.ok) continue;
        const next = r.value.doc;
        // A move is a new centre at the same size; a resize keeps the pieces in place (decks.30).
        const carries = next.decks[deckId]?.w === deck.w && next.decks[deckId]?.d === deck.d;
        const dx = (next.decks[deckId]?.at.x ?? 0) - deck.at.x;
        const dy = (next.decks[deckId]?.at.y ?? 0) - deck.at.y;
        if (carries && Object.values(doc.placements).some((p) => p.deck === deckId)) count("deck move carried");
        for (const p of Object.values(doc.placements)) {
          const q = next.placements[p.id];
          const want = p.deck === deckId && carries ? { x: roundMm(p.at.x + dx), y: roundMm(p.at.y + dy) } : p.at;
          if (!q || q.at.x !== want.x || q.at.y !== want.y || q.deck !== p.deck) failures.push(`${n} ${move ? "move" : "resize"} ${deckId}: ${p.id} at ${JSON.stringify(q?.at)}, expected ${JSON.stringify(want)}`);
        }
        doc = next;
      } else if (roll < 0.55) {
        // An existing piece moved and turned, from its current surface; accepted moves stay in the stream.
        const p = pick(Object.values(doc.placements));
        const o = doc.objects[p.object];
        const w = o?.w[p.config];
        const d = o?.d[p.config];
        const heights = o ? heightsOf(o, p.config) : null;
        if (!o || w === undefined || d === undefined || !heights) throw new Error("no piece");
        // Half the pieces on a deck stay near it, so many find their current surface again.
        const home = p.deck === null || random() < 0.5 ? null : doc.decks[p.deck];
        const at: Point = home ? { x: cm(home.at.x - 0.8, home.at.x + 0.8), y: cm(home.at.y - 0.8, home.at.y + 0.8) } : { x: cm(2, 7), y: cm(0, 2.6) };
        const rotation = pick([0, 90, 180, 270]);
        const tuck = tuckRole({ kind: o.kind, config: p.config, at, rotation, w, d }); // a chair may tuck under the desk (seating.14)
        const { outline, parts } = placedPiece(o.kind, at, w, d, rotation, o.arms);
        const c: LandingCandidate = { state: p.state, ring: outline, parts, heights, current: p.deck, ignore: [p.id], centre: quadCentre(footprintQuad(at, w, d, rotation)), tuck };
        // A piece is dragged where it shows: at the floor level, or at its own deck's level (step 07's selectableAt).
        const moved = check(`${n} move ${p.id}`, c, random() < 0.5 ? null : p.deck, (deck) => ({ type: "movePlacement", placementId: p.id, at, rotation, deck }));
        if (moved) doc = moved;
      } else {
        // A new piece of a kind, drawn to a size: probed only, except that one accepted on the loft at the loft's level
        // joins the stream while the loft holds fewer than four pieces, since a piece reaches the loft no other way (a
        // drag at the floor keeps it off).
        const kind = pick(KINDS);
        const config = kindConfigs(kind)[0]?.id;
        const stored = defaultSize(kind);
        const heights: Heights | null = stored && config ? heightsOf(stored, config) : null;
        if (!config || !heights) throw new Error("no kind");
        // Viewing the loft, it is drawn smaller and near the loft, so many land on it.
        const viewed = pick([null, "plat", "loft"]);
        const loft = viewed === "loft" ? doc.decks.loft : undefined;
        const w = loft ? cm(0.3, 0.8) : cm(0.3, 1.4);
        const d = loft ? cm(0.3, 0.8) : cm(0.3, 1.4);
        const at: Point = loft ? { x: cm(loft.at.x - 1, loft.at.x + 1), y: cm(loft.at.y - 0.8, loft.at.y + 0.6) } : { x: cm(2, 7), y: cm(0, 2.6) };
        const rotation = pick([0, 90, 180, 30]);
        const tuck = tuckRole({ kind, config, at, rotation, w, d });
        const { outline, parts } = placedPiece(kind, at, w, d, rotation);
        const c: LandingCandidate = { state: "s0", ring: outline, parts, heights, current: undefined, ignore: [], centre: quadCentre(footprintQuad(at, w, d, rotation)), tuck };
        const placed = check(`${n} place ${kind}`, c, viewed, (deck) => ({ type: "placeObject", opId: `g${n}`, state: "s0", object: { kind, size: { w, d } }, at, rotation, config, deck, linked: false })); // per layout: a linked move may be refused by another layout (review.06)
        if (placed && loft && Object.values(doc.placements).filter((q) => q.deck === "loft").length < 4) doc = placed; // room left to land
      }
    }
    console.log(`landing fuzz: ${JSON.stringify(Object.fromEntries([...seen].sort()))}`);
    expect(failures.slice(0, 10)).toEqual([]);
    const levelKeys = ["fits at the floor level", "fits at the upper level", "none at the upper level", "no surface at the upper level", "current at another level"];
    for (const k of [...levelKeys, "fits floor", "fits current", "fits deck", "none floor", "none current", "deck move ok", "deck move refused", "deck move carried", "deck resize ok", "deck resize refused"]) {
      expect({ k, enough: (seen.get(k) ?? 0) >= 20 }).toEqual({ k, enough: true });
    }
  });
});
