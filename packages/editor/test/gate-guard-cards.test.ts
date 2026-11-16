import { describe, expect, it } from "vitest";
import { toStored, type Document } from "@fm/domain";
import { CARD_STYLE } from "../src/view/card-look";
import type { Primitive } from "../src/view/scene-types";
import type { ProjectCard } from "../src/view/view-model-types";
import { faces3d } from "../src/view3d/faces";
import { STYLE_3D } from "../src/view3d/style";
import { roomDoc, serverState, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The final gate's AC-07 gap: a project card carries guards, on its plan and in its 3D hover frame. The 6 × 4 room has
// two 1 × 1 platforms, below the floor's cut so the card's floor plan shows them: a Railing one at x 1–2 and a Glass one
// at x 4–5, both y 1.5–2.5.

const doc: Document = withCommands(
  roomDoc(),
  { type: "addDeck", opId: "r", preset: "platform", at: { x: 1.5, y: 2 }, w: 1, d: 1, guard: "railing" },
  { type: "addDeck", opId: "g", preset: "platform", at: { x: 4.5, y: 2 }, w: 1, d: 1, guard: "glass" },
);

/** A card for `doc`, seen and hovered, as the project list shows it. */
function hoveredCard(): ProjectCard {
  const host = new FakeHost();
  const shell = new FakeShell(serverState(host), host);
  shell.send({ type: "serverEvent", event: { type: "connection", state: "open" } });
  shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r", items: [{ id: "p1", name: "Platforms" }] } });
  shell.ui({ type: "cardSeen", id: "p1" });
  const read = shell.effectsOf("workspace").flatMap((e) => (e.op.type === "read" ? [e.op] : [])).at(-1);
  if (!read) throw new Error("no read");
  shell.send({ type: "workspaceEvent", event: { type: "drawing", requestId: read.requestId, projectId: "p1", doc: toStored(doc) } });
  shell.ui({ type: "cardHover", id: "p1" });
  const card = shell.view().projectList?.items.find((c) => c.id === "p1");
  if (!card) throw new Error("no card");
  return card;
}

type Segment = Extract<Primitive, { kind: "segment" }>;
type Disc = Extract<Primitive, { kind: "disc" }>;
const within = (x0: number, x1: number) => (p: { x: number; y: number }): boolean => p.x > x0 - 1e-6 && p.x < x1 + 1e-6 && p.y > 1.5 - 1e-6 && p.y < 2.5 + 1e-6;
const RAILING = within(1, 2);
const GLASS = within(4, 5);

describe("a project card's guards (AC-07)", () => {
  it("its plan and its 3D frame carry a Railing, with posts and a top rail, and a Glass guard, a pane in the glass colour", () => {
    const card = hoveredCard();
    const ps = card.picture?.primitives ?? [];
    const lines = ps.filter((p): p is Segment => p.kind === "segment" && "px" in p.width && p.width.px === CARD_STYLE.guard.line);
    const posts = ps.filter((p): p is Disc => p.kind === "disc" && "px" in p.radius && p.radius.px === CARD_STYLE.guard.post);
    expect(lines.filter((l) => RAILING(l.a) && RAILING(l.b)).map((l) => l.color)).toEqual(Array(4).fill(CARD_STYLE.guard.ink));
    expect(lines.filter((l) => GLASS(l.a) && GLASS(l.b)).map((l) => l.color)).toEqual(Array(4).fill(CARD_STYLE.openingGlass));
    expect(posts.filter((d) => RAILING(d.center)).length).toBeGreaterThanOrEqual(4); // a post at each corner at least
    expect(posts.filter((d) => GLASS(d.center))).toEqual([]);

    const guards = card.view3d?.scene.items.flatMap((i) => (i.item === "guard" ? [i] : [])) ?? [];
    const railing = guards.filter((g) => g.kind === "railing" && RAILING(g.a) && RAILING(g.b)).flatMap((g) => faces3d(g));
    const glass = guards.filter((g) => g.kind === "glass" && GLASS(g.a) && GLASS(g.b)).flatMap((g) => faces3d(g));
    expect(railing.length).toBeGreaterThan(0);
    expect(railing.some((f) => f.color === STYLE_3D.glass)).toBe(false);
    // Posts reach down to the platform's top, 0.45; the top rail spans a whole 1 m side.
    expect(railing.some((f) => f.points.some((p) => Math.abs(p.z - 0.45) < 1e-6))).toBe(true);
    expect(railing.some((f) => { const xs = f.points.map((p) => p.x); return Math.max(...xs) - Math.min(...xs) > 0.99; })).toBe(true);
    const pane = glass.filter((f) => f.color === STYLE_3D.glass);
    expect(pane.length).toBeGreaterThan(0);
    const paneTop = Math.max(...pane.flatMap((f) => f.points.map((p) => p.z)));
    expect(glass.some((f) => f.color !== STYLE_3D.glass && f.points.every((p) => p.z >= paneTop - 1e-6))).toBe(true); // the rail on top
  });
});
