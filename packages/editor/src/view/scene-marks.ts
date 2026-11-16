import { add, levelOf, normalize, perpLeft, scale, sub } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import { activeStateId, viewedLevelOn, type EditorState } from "../state";
import { COLORS } from "./colors";
import type { Primitive } from "./scene-types";
import { HELPER_FONT } from "./fonts";

/** The word beside a snap's mark (straight step 22, law 7: a marker plus a word); the grid has none. */
function snapWord(snap: NonNullable<EditorState["snap"]>): string | null {
  switch (snap.kind) {
    case "endpoint": return "Endpoint";
    case "midpoint": return "Midpoint";
    case "perpendicular": return "Perpendicular";
    case "onWall": return "On wall";
    case "aligned": return "Aligned";
    case "equal": return "Equal";
    case "angle": { // the ray's angle from +x, as the Wall tool's label shows it
      const from = snap.guides?.[0];
      if (!from) return null;
      const deg = Math.round((Math.atan2(snap.point.y - from.y, snap.point.x - from.x) * 180) / Math.PI);
      return `${((deg % 360) + 360) % 360}°`;
    }
    case "edge": return snap.word ?? null;
    case "grid":
    case "none":
      return null;
    default:
      return assertNever(snap.kind);
  }
}

export function drawSnap(state: EditorState, out: Primitive[]): void {
  const snap = state.snap;
  if (!snap || snap.kind === "none") return;
  const r = 5 / state.camera.zoom;
  const { x, y } = snap.point;
  const seg = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: { px: 1.5 }, color: COLORS.snap, cap: "round" });
  const ring = (pts: Point[]): Primitive[] => pts.map((a, i) => seg(a, pts[(i + 1) % pts.length] ?? a));
  const word = snapWord(snap);
  if (word !== null) out.push({ kind: "text", text: word, at: { x: x + 2 * r, y: y - 2 * r }, size: HELPER_FONT.size, color: COLORS.snap, align: "left", rotation: 0, font: HELPER_FONT.font });
  switch (snap.kind) {
    case "endpoint":
      out.push(...ring([{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }]));
      return;
    case "midpoint":
      out.push(...ring([{ x, y: y + r }, { x: x - r, y: y - r }, { x: x + r, y: y - r }]));
      return;
    case "perpendicular": {
      // A right-angle mark in the corner between the wall and the line to the origin (guides[0]).
      const from = snap.guides?.[0];
      const u = (from && normalize(sub(from, snap.point))) ?? { x: 0, y: -1 };
      const w = perpLeft(u); // along the wall
      const corner = add(snap.point, add(scale(u, r), scale(w, r)));
      out.push(seg(add(snap.point, scale(u, r)), corner), seg(corner, add(snap.point, scale(w, r))));
      return;
    }
    case "onWall":
      out.push(seg({ x: x - r, y: y - r }, { x: x + r, y: y + r }), seg({ x: x - r, y: y + r }, { x: x + r, y: y - r }));
      return;
    case "angle": // a guide from the origin (and from the joint on a tie), like aligned
    case "aligned":
      for (const g of snap.guides ?? []) {
        out.push({ kind: "segment", a: g, b: snap.point, width: { px: 1 }, color: COLORS.snapGuide, cap: "butt" });
      }
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    case "grid":
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    case "equal": // an "=" on the matched wall and on the moving one, and the dot
      for (const g of snap.guides ?? []) out.push({ kind: "text", text: "=", at: g, size: HELPER_FONT.size + 3, color: COLORS.snap, align: "center", rotation: 0, font: HELPER_FONT.font });
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    case "edge":
      out.push(...ring([{ x, y: y + r }, { x: x + r, y }, { x, y: y - r }, { x: x - r, y }])); // its word drawn above, as every kind's
      return;
    default:
      assertNever(snap.kind);
  }
}

/**
 * Remote cursors with their names, in each collaborator's colour (spec: collaboration). A collaborator in another layout state
 * reads "Bob · Night" (spec: layouts); an unknown or missing state reads just "Bob". One at another level's height adds that
 * level's name: "Bob · Loft", "Bob · Night · Loft", "Bob · Floor"; two decks at one height are one level, and a deck
 * this client doesn't hold as a level is the floor (levels.11). Remote selections are not drawn.
 */
export function drawPresence(state: EditorState, out: Primitive[]): void {
  const offset = 10 / state.camera.zoom;
  const doc = state.document ? visibleDoc(state.document) : null;
  const mine = activeStateId(state);
  const myHeight = doc ? viewedLevelOn(state, doc).height : 0;
  for (const p of Object.values(state.presence)) {
    if (!p.cursor) continue;
    const theirs = doc && p.state !== null && p.state !== mine && Object.hasOwn(doc.states, p.state) ? doc.states[p.state] : undefined;
    const level = doc ? levelOf(doc, p.level) : null;
    const levelName = level && level.height !== myHeight ? level.name : undefined;
    const text = [p.name, theirs?.name, levelName].filter((part) => part !== undefined).join(" · ");
    const color = p.color.toLowerCase(); // the wire allows #RRGGBB; the Scene's colours are lowercase (render.12)
    out.push({ kind: "disc", center: p.cursor, radius: { px: 5 }, color });
    out.push({
      kind: "text", text, at: { x: p.cursor.x + offset, y: p.cursor.y - offset },
      size: HELPER_FONT.size, color, align: "left", rotation: 0, font: HELPER_FONT.font,
    });
  }
}
