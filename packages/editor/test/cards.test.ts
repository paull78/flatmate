import { describe, expect, it } from "vitest";
import { emptyDocument, toStored } from "@fm/domain";
import { cardFrame3d } from "../src/view3d-state";
import { camera3d, DEFAULT_ANGLES, shellBounds, TILT_MAX, TILT_MIN } from "../src/view3d/camera3d";
import { sceneFaces } from "../src/view3d/scene-faces";
import { framedBounds, SURROUNDINGS } from "../src/view3d/surroundings";
import { trailerFaces } from "../src/view3d/trailer-faces";
import { CARD_COLOURS, cardColour } from "../src/view/cards";
import type { ProjectCard } from "../src/view/view-model-types";
import { bed160x200, roomDoc, serverState, studioDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The project cards (cycle cards): a card's drawing is fetched once it's seen, once per list opening.

const P1 = { id: "p1", name: "Flat" };
const P2 = { id: "p2", name: "Studio" };

function listShell(): FakeShell {
  const host = new FakeHost();
  const shell = new FakeShell(serverState(host), host);
  shell.send({ type: "serverEvent", event: { type: "connection", state: "open" } });
  shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r", items: [P1, P2] } });
  return shell;
}

const reads = (shell: FakeShell) => shell.effectsOf("workspace").flatMap((e) => (e.op.type === "read" ? [e.op] : []));

function card(shell: FakeShell, id: string): ProjectCard {
  const found = shell.view().projectList?.items.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}

function seen(shell: FakeShell, id = "p1", doc = roomDoc()): void {
  shell.ui({ type: "cardSeen", id });
  const op = reads(shell).at(-1);
  if (!op) throw new Error("no read");
  shell.send({ type: "workspaceEvent", event: { type: "drawing", requestId: op.requestId, projectId: id, doc: toStored(doc) } });
}

describe("a card's plan", () => {
  it("has no section marks: it blanks them, as it does all text, and keeps its frame", () => {
    const plain = roomDoc();
    const cut = withCommands(plain, { type: "addSection", a: { x: -3, y: 2 }, b: { x: 9, y: 2 }, side: 1 });
    const picture = (doc: typeof plain) => {
      const shell = listShell();
      seen(shell, "p1", doc);
      return card(shell, "p1").picture;
    };
    expect(picture(plain)?.primitives.length).toBeGreaterThan(0);
    expect(picture(cut)).toEqual(picture(plain));
  });
});

describe("a card's colour (AC-02)", () => {
  it("is the same for the same id", () => {
    expect(cardColour("project-a")).toBe(cardColour("project-a"));
  });

  it("is one of the 14, and 1000 ids reach them all", () => {
    expect(CARD_COLOURS).toHaveLength(14);
    const used = new Set(Array.from({ length: 1000 }, (_, i) => cardColour(`id-${i}`)));
    expect([...used].every((c) => CARD_COLOURS.includes(c))).toBe(true);
    expect(used.size).toBe(14);
  });

  it("comes with the card", () => {
    expect(card(listShell(), "p1").colour).toBe(cardColour("p1"));
  });
});

describe("fetching a card's drawing (AC-13)", () => {
  it("isn't asked for until the card is seen", () => {
    const shell = listShell();
    expect(reads(shell)).toEqual([]);
    expect(card(shell, "p1").status).toBe("unseen");
  });

  it("is asked once, and only for that card", () => {
    const shell = listShell();
    shell.ui({ type: "cardSeen", id: "p1" });
    shell.ui({ type: "cardSeen", id: "p1" });
    expect(reads(shell).map((r) => r.projectId)).toEqual(["p1"]);
    expect(card(shell, "p1").status).toBe("loading");
    expect(card(shell, "p2").status).toBe("unseen");
  });

  it("isn't asked for a project the list doesn't have", () => {
    const shell = listShell();
    shell.ui({ type: "cardSeen", id: "gone" });
    expect(reads(shell)).toEqual([]);
  });

  it("is asked again when the list opens again (AC-10's fresh edits)", () => {
    const shell = listShell();
    seen(shell);
    shell.ui({ type: "showProjectList" });
    shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r2", items: [P1, P2] } });
    expect(card(shell, "p1").status).toBe("unseen");
    shell.ui({ type: "cardSeen", id: "p1" });
    expect(reads(shell)).toHaveLength(2);
  });

  it("is asked again after a reconnect", () => {
    const shell = listShell();
    seen(shell);
    shell.send({ type: "serverEvent", event: { type: "connection", state: "closed" } });
    shell.send({ type: "serverEvent", event: { type: "connection", state: "open" } });
    expect(card(shell, "p1").status).toBe("unseen");
  });

  it("keeps a delete's reply from asking again", () => {
    const shell = listShell();
    seen(shell);
    shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r3", items: [P1] } });
    expect(card(shell, "p1").status).toBe("ready");
  });

  it("ignores a late answer to an older request", () => {
    const shell = listShell();
    seen(shell);
    const old = reads(shell)[0];
    shell.ui({ type: "showProjectList" });
    shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r2", items: [P1, P2] } });
    shell.send({ type: "workspaceEvent", event: { type: "drawing", requestId: old?.requestId ?? "", projectId: "p1", doc: toStored(roomDoc()) } });
    expect(card(shell, "p1").status).toBe("unseen");
  });
});

describe("a card's picture (AC-01, AC-04)", () => {
  it("is the plan of a drawing with walls", () => {
    const shell = listShell();
    seen(shell);
    const c = card(shell, "p1");
    expect(c.status).toBe("ready");
    expect(c.picture?.primitives.length).toBeGreaterThan(0);
    expect(c.picture?.frame.zoom).toBeGreaterThan(0);
  });

  it("keeps the same picture between view models", () => {
    const shell = listShell();
    seen(shell);
    expect(card(shell, "p1").picture).toBe(card(shell, "p1").picture);
    shell.ui({ type: "cardSeen", id: "p2" });
    expect(card(shell, "p1").picture).toBe(card(shell, "p1").picture);
  });

  it("has no text on it", () => {
    const shell = listShell();
    seen(shell);
    expect(card(shell, "p1").picture?.primitives.some((p) => p.kind === "text")).toBe(false);
  });

  it("is empty for a drawing with nothing in it", () => {
    const shell = listShell();
    seen(shell, "p1", emptyDocument());
    expect(card(shell, "p1").status).toBe("empty");
    expect(card(shell, "p1").picture).toBeNull();
  });

  it("fails quietly for no drawing, with no error line", () => {
    const shell = listShell();
    shell.ui({ type: "cardSeen", id: "p1" });
    const op = reads(shell).at(-1);
    shell.send({ type: "workspaceEvent", event: { type: "drawing", requestId: op?.requestId ?? "", projectId: "p1", doc: null } });
    expect(card(shell, "p1").status).toBe("failed");
    expect(card(shell, "p1").picture).toBeNull();
    expect(shell.view().projectList?.error).toBeNull();
  });

  it("fails quietly for a drawing that doesn't read", () => {
    const shell = listShell();
    shell.ui({ type: "cardSeen", id: "p1" });
    const op = reads(shell).at(-1);
    const broken = { ...toStored(roomDoc()), walls: { w1: { id: "w1", a: "missing", b: "gone" } } };
    shell.send({ type: "workspaceEvent", event: { type: "drawing", requestId: op?.requestId ?? "", projectId: "p1", doc: broken } });
    expect(card(shell, "p1").status).toBe("failed");
  });
});

describe("hovering and turning a card (AC-05, AC-06, AC-07)", () => {
  const hover = (shell: FakeShell, id: string | null = "p1"): void => shell.ui({ type: "cardHover", id });
  const orbit = (shell: FakeShell, dx: number, dy: number, width = 200): void => shell.ui({ type: "cardOrbit", dx, dy, width });
  const angles = (shell: FakeShell, id = "p1") => card(shell, id).view3d?.angles;
  const ready = (): FakeShell => {
    const shell = listShell();
    seen(shell);
    return shell;
  };

  it("has no 3D until it is hovered", () => {
    const shell = ready();
    expect(card(shell, "p1").view3d).toBeNull();
    expect(card(shell, "p1").canTurn).toBe(true);
  });

  it("starts at the default angles", () => {
    const shell = ready();
    hover(shell);
    expect(angles(shell)).toEqual({ yaw: 225, tilt: 35 });
    expect(card(shell, "p2").view3d).toBeNull();
  });

  it("turns a full circle over a card's width, lower when dragging right", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 50, 0);
    expect(angles(shell)?.yaw).toBeCloseTo(135, 6);
    orbit(shell, 150, 0);
    expect(angles(shell)?.yaw).toBeCloseTo(225, 6);
  });

  it("turns by the same angle on any card width", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 100, 0, 400);
    expect(angles(shell)?.yaw).toBeCloseTo(135, 6);
  });

  it("tilts at 0.4 degrees a pixel, held to the range", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 0, 10);
    expect(angles(shell)?.tilt).toBeCloseTo(39, 6);
    orbit(shell, 0, 10000);
    expect(angles(shell)?.tilt).toBe(TILT_MAX);
    orbit(shell, 0, -10000);
    expect(angles(shell)?.tilt).toBe(TILT_MIN);
  });

  it("ignores a width of nothing", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 50, 0, 0);
    expect(angles(shell)).toEqual({ yaw: 225, tilt: 35 });
  });

  it("does nothing without a hover", () => {
    const shell = ready();
    orbit(shell, 50, 0);
    expect(card(shell, "p1").view3d).toBeNull();
  });

  it("keeps the same frame while nothing it shows changes", () => {
    const shell = ready();
    hover(shell);
    const before = card(shell, "p1").view3d;
    shell.ui({ type: "cardSeen", id: "p2" });
    expect(card(shell, "p1").view3d).toBe(before);
  });

  it("goes back to the plan on leaving, and the next hover starts at the default", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 50, 10);
    hover(shell, null);
    expect(card(shell, "p1").view3d).toBeNull();
    hover(shell);
    expect(angles(shell)).toEqual({ yaw: 225, tilt: 35 });
  });

  it("keeps the angle when the same card is hovered again", () => {
    const shell = ready();
    hover(shell);
    orbit(shell, 50, 0);
    hover(shell);
    expect(angles(shell)?.yaw).toBeCloseTo(135, 6);
  });

  it("has no 3D for a drawing without walls, nor one that hasn't loaded", () => {
    const shell = listShell();
    seen(shell, "p1", emptyDocument());
    hover(shell);
    expect(card(shell, "p1").canTurn).toBe(false);
    expect(card(shell, "p1").view3d).toBeNull();
    hover(shell, "p2");
    expect(card(shell, "p2").canTurn).toBe(false);
    expect(card(shell, "p2").view3d).toBeNull();
  });

  it("forgets the hover when the list closes", () => {
    const shell = ready();
    hover(shell);
    shell.ui({ type: "openProject", id: "p1" });
    expect(shell.state.workspace.hover).toBeNull();
  });
});

describe("a card's 3D with surroundings (surroundings.07, AC-07)", () => {
  const styled = (value: string) => withCommands(roomDoc(), { type: "setProjectField", key: "surroundings", value });

  it("a card in Outside has today's bounds and faces", () => {
    const today = cardFrame3d(roomDoc(), "s0", null, 225, 35);
    if (!today) throw new Error("the room should frame a card");
    for (const value of ["outside", "interior", "grid"]) {
      const f = cardFrame3d(styled(value), "s0", null, 225, 35);
      expect(f?.scene.bounds, value).toEqual(shellBounds(roomDoc()));
      expect([f?.scene.ground, f?.scene.background, f?.scene.trailer], value).toEqual([undefined, undefined, undefined]);
      expect(f && sceneFaces(f.scene), value).toEqual(sceneFaces(today.scene));
    }
  });

  it("a card on wheels draws its trailer and no ground, its bounds pulled with the bottom (step 12)", () => {
    const today = cardFrame3d(roomDoc(), "s0", null, 225, 35);
    const shell = shellBounds(roomDoc());
    if (!today || !shell) throw new Error("the room should frame a card");
    const f = cardFrame3d(styled("wheels"), "s0", null, 225, 35);
    expect(f?.scene.bounds).toEqual({ ...shell, bottom: -0.75, pull: 0.88 });
    expect([f?.scene.ground, f?.scene.background]).toEqual([undefined, undefined]); // the canvas stays clear over the card's grid
    expect(f?.scene.trailer).toEqual(trailerFaces(framedBounds(SURROUNDINGS.wheels, shell)));
    const faces = f ? sceneFaces(f.scene) : [];
    expect(faces.some((x) => x.owner.startsWith("ground/"))).toBe(false);
    expect(faces.filter((x) => !x.owner.startsWith("trailer/"))).toEqual(sceneFaces(today.scene)); // the house as under None
    expect(faces.filter((x) => x.owner.startsWith("trailer/drawbar")).length).toBeGreaterThan(0);
  });

  // A card shows its picture's centred square through a frame 10 % in on each side of a 4:3 card (styles.css
  // .project-card-3d), so only clip y within ±0.833 shows; x shows whole (surroundings.16).
  it("on the studio, the deck, axles and wheels stay within the card's clip y ±0.833 at every step, and the whole trailer at the default view", () => {
    const doc = withCommands(studioDoc(), { type: "setProjectField", key: "surroundings", value: "wheels" });
    const shown = 1 / 1.2;
    let worstAnywhere = 0;
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (let tilt = TILT_MIN; tilt <= TILT_MAX; tilt += 5) {
        const f = cardFrame3d(doc, "s0", null, yaw, tilt);
        if (!f) throw new Error("the studio should frame a card");
        const cam = camera3d(f.scene.bounds, f.angles);
        const parts = (f.scene.trailer ?? []).filter((x) => /^trailer\/(deck|axle|wheel)/.test(x.owner));
        expect(parts.length).toBeGreaterThan(50);
        const worst = Math.max(...parts.flatMap((x) => x.points.map((p) => Math.abs(cam.project(p).y))));
        expect(worst, `yaw ${yaw}, tilt ${tilt}`).toBeLessThanOrEqual(shown);
        worstAnywhere = Math.max(worstAnywhere, worst);
      }
    }
    expect(worstAnywhere, "the deck nearly reaches the card's edge at its worst view").toBeGreaterThan(0.7);
    const f = cardFrame3d(doc, "s0", null, DEFAULT_ANGLES.yaw, DEFAULT_ANGLES.tilt);
    if (!f) throw new Error("the studio should frame a card");
    const cam = camera3d(f.scene.bounds, f.angles);
    const all = (f.scene.trailer ?? []).flatMap((x) => x.points);
    expect(all.some((p) => p.x > 7.1)).toBe(true); // the drawbar is there
    expect(Math.max(...all.map((p) => Math.abs(cam.project(p).y)))).toBeLessThanOrEqual(shown);
  });

  it("the card in the list draws no ground either", () => {
    const shell = listShell();
    seen(shell, "p1", styled("outside"));
    shell.ui({ type: "cardHover", id: "p1" });
    const scene = card(shell, "p1").view3d?.scene;
    expect(scene?.items.length).toBeGreaterThan(0);
    expect([scene?.ground, scene?.background, scene?.bounds.pull]).toEqual([undefined, undefined, undefined]);
  });
});

describe("the layout pill (AC-09)", () => {
  // A bed centred on (1.5, 2) in Layout and on (3.5, 2) in Night, as the editor's flip test has it.
  const twoLayouts = () =>
    withCommands(
      roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 } },
      { type: "placeObject", linked: false, deck: null, opId: "b2", state: "n/s0", object: { existing: "bed/o0" }, at: { x: 3.5, y: 3 } },
      bed160x200("bed/o0"),
    );
  const threeLayouts = () => withCommands(twoLayouts(), { type: "addState", opId: "e", name: "Evening" });
  const next = (shell: FakeShell, id = "p1") => shell.send({ type: "ui", action: { type: "cardNextLayout", id } });
  const frame = (shell: FakeShell, now: number) => shell.send({ type: "frame", now });
  const asksFrame = (effects: { type: string }[]) => effects.some((e) => e.type === "requestFrame");
  const ready = (doc = twoLayouts()): FakeShell => {
    const shell = listShell();
    seen(shell, "p1", doc);
    return shell;
  };
  const bedCentre = (shell: FakeShell): number | undefined => {
    const piece = card(shell, "p1").view3d?.scene.items.find((i) => i.item === "piece");
    return piece?.item === "piece" ? +piece.centre.x.toFixed(3) : undefined;
  };

  it("has no pill for one layout", () => {
    expect(card(ready(roomDoc()), "p1").layouts).toBeNull();
  });

  it("names the layout shown, first by order", () => {
    expect(card(ready(), "p1").layouts).toEqual({ name: "Layout", index: 0, count: 2 });
  });

  it("moves to the next and wraps", () => {
    const shell = ready(threeLayouts());
    next(shell);
    expect(card(shell, "p1").layouts).toEqual({ name: "Night", index: 1, count: 3 });
    next(shell);
    expect(card(shell, "p1").layouts?.name).toBe("Evening");
    next(shell);
    expect(card(shell, "p1").layouts?.name).toBe("Layout");
  });

  it("changes the plan at once, with no frames at rest", () => {
    const shell = ready();
    const before = card(shell, "p1").picture;
    expect(asksFrame(next(shell))).toBe(false);
    expect(card(shell, "p1").picture).not.toBe(before);
    expect(shell.state.workspace.cardFlip).toBeNull();
  });

  it("glides in 3D over 500 ms, and keeps the angle", () => {
    const shell = ready();
    shell.ui({ type: "cardHover", id: "p1" });
    shell.ui({ type: "cardOrbit", dx: 50, dy: 0, width: 200 });
    const angles = card(shell, "p1").view3d?.angles;
    expect(bedCentre(shell)).toBeCloseTo(1.5, 3);
    expect(asksFrame(next(shell))).toBe(true);
    expect(card(shell, "p1").view3d?.angles).toEqual(angles);
    expect(asksFrame(frame(shell, 250))).toBe(true);
    expect(bedCentre(shell)).toBeCloseTo(2.5, 3);
    expect(asksFrame(frame(shell, 600))).toBe(false);
    expect(bedCentre(shell)).toBeCloseTo(3.5, 3);
    expect(shell.state.workspace.cardFlip).toBeNull();
    expect(card(shell, "p1").view3d?.angles).toEqual(angles);
  });

  it("starts from the layout shown on a second click mid-change", () => {
    const shell = ready(threeLayouts());
    shell.ui({ type: "cardHover", id: "p1" });
    next(shell);
    frame(shell, 100);
    next(shell);
    expect(shell.state.workspace.cardFlip).toMatchObject({ t: 0 });
    expect(card(shell, "p1").layouts?.name).toBe("Evening");
    frame(shell, 700);
    expect(shell.state.workspace.cardFlip).toBeNull();
    expect(card(shell, "p1").layouts?.name).toBe("Evening");
  });

  it("isn't stuck when the mouse leaves mid-change", () => {
    const shell = ready();
    shell.ui({ type: "cardHover", id: "p1" });
    next(shell);
    frame(shell, 100);
    shell.ui({ type: "cardHover", id: null });
    expect(shell.state.workspace.cardFlip).toBeNull();
    expect(asksFrame(frame(shell, 200))).toBe(false);
    expect(card(shell, "p1").layouts?.name).toBe("Night");
    shell.ui({ type: "cardHover", id: "p1" });
    expect(bedCentre(shell)).toBeCloseTo(3.5, 3);
  });

  it("keeps the choice after leaving, and forgets it when the list reopens", () => {
    const shell = ready();
    next(shell);
    shell.ui({ type: "cardHover", id: "p1" });
    shell.ui({ type: "cardHover", id: null });
    expect(card(shell, "p1").layouts?.name).toBe("Night");
    shell.ui({ type: "showProjectList" });
    shell.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r2", items: [P1, P2] } });
    seen(shell, "p1", twoLayouts());
    expect(card(shell, "p1").layouts?.name).toBe("Layout");
  });

  it("ignores a card with no layouts to move to", () => {
    const shell = ready(roomDoc());
    expect(asksFrame(next(shell))).toBe(false);
    expect(asksFrame(next(shell, "p2"))).toBe(false);
    expect(shell.state.workspace.layouts).toEqual({});
  });

  it("asks for no frame when nothing is gliding", () => {
    expect(asksFrame(frame(ready(), 100))).toBe(false);
  });
});

describe("the list's order (AC-15)", () => {
  const LISTED = [{ id: "a", name: "Attic", editedAt: 100 }, { id: "b", name: "Barn", editedAt: 300 }, { id: "c", name: "Cabin", editedAt: 300 }, { id: "d", name: "Dorm", editedAt: 200 }];
  const shell = (items: { id: string; name: string; editedAt?: number }[] = LISTED): FakeShell => {
    const host = new FakeHost();
    const s = new FakeShell(serverState(host), host);
    s.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r", items } });
    return s;
  };
  const names = (s: FakeShell) => s.view().projectList?.items.map((c) => c.name);

  it("is by name by default, as the server lists them", () => {
    const s = shell();
    expect(s.view().projectList?.order).toBe("name");
    expect(names(s)).toEqual(["Attic", "Barn", "Cabin", "Dorm"]);
  });

  it("puts the last edited first under Recent, ties by name", () => {
    const s = shell();
    s.ui({ type: "setCardOrder", order: "recent" });
    expect(s.view().projectList?.order).toBe("recent");
    expect(names(s)).toEqual(["Barn", "Cabin", "Dorm", "Attic"]);
  });

  it("goes back to A to Z", () => {
    const s = shell();
    s.ui({ type: "setCardOrder", order: "recent" });
    s.ui({ type: "setCardOrder", order: "name" });
    expect(names(s)).toEqual(["Attic", "Barn", "Cabin", "Dorm"]);
  });

  it("counts a project with no date as the newest", () => {
    const s = shell([...LISTED, { id: "e", name: "Eave" }]);
    s.ui({ type: "setCardOrder", order: "recent" });
    expect(names(s)?.[0]).toBe("Eave");
  });

  it("survives the list reopening", () => {
    const s = shell();
    s.ui({ type: "setCardOrder", order: "recent" });
    s.ui({ type: "showProjectList" });
    s.send({ type: "workspaceEvent", event: { type: "projects", requestId: "r2", items: LISTED } });
    expect(names(s)?.[0]).toBe("Barn");
  });
});
