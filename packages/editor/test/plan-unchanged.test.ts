import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, SURROUNDINGS_VALUES, levels, motifDefaults, type Command, type Document } from "@fm/domain";
import { CANVAS_STYLE, pictureLayers, planPicture, type PlanPicture } from "../src/view/picture";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Scene } from "../src/view/scene-types";
import { clearRoomDoc, labelledDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The plan is unchanged by the parts cycle (parts AC-11): one piece of every live furniture kind in each of its
// configurations, drawn as the canvas draws it, compared with a committed snapshot taken before the cycle's code moved.

// The kinds the snapshot was taken with: the hung pieces and the coat stand came later, and their symbols are
// hangings-symbols.test.ts's (hangings step 02); this file keeps guarding the older ones unchanged.
const LATER = new Set(["picture", "mirror", "clock", "wallTv", "pegboard", "coatHooks", "coatStand", "glassCabinet", "halfGlassCabinet"]); // and the glass cabinets (cabinets-symbols.test.ts)
const kinds = OBJECT_KINDS.filter((k) => !k.retired && k.stair === null && !LATER.has(k.id));

function furnished() {
  const places: Command[] = [];
  let i = 0;
  for (const k of kinds) {
    for (const c of k.configs) {
      const at = { x: 1.5 + (i % 8) * 3, y: 2.9 + Math.floor(i / 8) * 3 };
      places.push({ type: "placeObject", deck: null, opId: `p${i}`, state: "s0", object: { kind: k.id }, at, config: c.id });
      i++;
    }
  }
  return withCommands(clearRoomDoc(24, 30, "r"), ...places);
}

describe("the plan picture", () => {
  it("of a drawing with every furniture kind is frozen", async () => {
    const doc = furnished();
    const prims = pictureLayers(planPicture(doc, floorView(doc, "s0"), { ...CANVAS_STYLE, wall: "#1d1d1f" }, 40, true));
    expect(prims.length).toBeGreaterThan(kinds.length * 4);
    await expect(JSON.stringify(prims, null, 1)).toMatchFileSnapshot("./__snapshots__/plan-unchanged.json");
  });

  // Surroundings draw only in 3D (AC-11): the same drawing with each one set still matches the frozen file.
  it.each(SURROUNDINGS_VALUES.map((s) => s.value))("matches the same frozen file with %s set", async (value) => {
    const doc = withCommands(furnished(), { type: "setProjectField", key: "surroundings", value });
    expect(doc.projectFields["surroundings"]?.value).toBe(value);
    const prims = pictureLayers(planPicture(doc, floorView(doc, "s0"), { ...CANVAS_STYLE, wall: "#1d1d1f" }, 40, true));
    await expect(JSON.stringify(prims, null, 1)).toMatchFileSnapshot("./__snapshots__/plan-unchanged.json");
  });

  // The frozen drawing has no finish, deck, opening, dimension, section, loft or roof, so those layers are empty there and a
  // layer reading the row would go unseen. This one draws every layer at its floor or its loft, with each style or none.
  const layered = (...cmds: Command[]): Document => {
    const base = labelledDoc();
    const bottom = wallBetween(base, { x: 0, y: 0 }, { x: 3, y: 0 });
    const divider = wallBetween(base, { x: 3, y: 0 }, { x: 3, y: 4 });
    const planks = motifDefaults("planks");
    const doc = withCommands(
      base,
      { type: "setFinish", id: "L1", finish: planks },
      { type: "setCeiling", height: 3.05, shape: "shed" }, // a roof, so its layer draws (roofs.11)
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.5, y: 2.6 }, w: 2, d: 1.6 },
      { type: "addDeck", opId: "plat", preset: "platform", at: { x: 2, y: 1 }, w: 0.8, d: 0.8 },
      { type: "addOpening", opId: "door", wall: bottom, kind: "swing", offset: 0.5, width: 0.8 },
      { type: "setWallTop", wallId: divider, top: 2 }, // a ghost at the loft
      { type: "addDimension", opId: "m", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 },
      { type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1 },
      { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 1, y: 3 } },
    );
    return withCommands(doc, ...Object.keys(doc.decks).map((deckId): Command => ({ type: "setDeckFinish", deckId, finish: planks })), ...cmds);
  };
  const pictures = (doc: Document): PlanPicture[] => levels(doc).map((level) => planPicture(doc, viewAt("s0", level), CANVAS_STYLE, 40, true));

  it("of a drawing with every layer drawn is the same with each style set as with none", () => {
    const without = pictures(layered());
    const drawn = new Set(without.flatMap((p) => Object.entries(p).flatMap(([layer, prims]) => (prims.length > 0 ? [layer] : []))));
    expect(Object.keys(without[0] ?? {}).filter((layer) => !drawn.has(layer)), "layers empty at both levels").toEqual([]);
    for (const { value } of SURROUNDINGS_VALUES) {
      const doc = layered({ type: "setProjectField", key: "surroundings", value });
      expect(doc.projectFields["surroundings"]?.value).toBe(value);
      expect(pictures(doc), value).toEqual(without);
    }
  });

  // The live canvas builds its plan layers itself, not through planPicture, and picture.test.ts holds them equal to it
  // only for a document with no row: so the Scene too, at the floor and at the loft, with each style or none.
  it("on the canvas, of the same drawing, is the same with each style set as with none", () => {
    const scenes = (doc: Document): Scene[] => {
      const shell = FakeShell.withDocument(doc);
      const floor = shell.scene();
      shell.key("PageUp");
      expect(shell.state.viewedDeck, "the loft is viewed").not.toBeNull();
      return [floor, shell.scene()];
    };
    const without = scenes(layered());
    const drawn = (scene: Scene | undefined): string[] => (scene?.layers ?? []).flatMap((l) => (l.primitives.length > 0 ? [l.name] : []));
    expect(drawn(without[0]), "layers drawn at the floor").toEqual(expect.arrayContaining(["finishes", "decks", "objects", "walls", "openings", "tags", "dimensions", "marks"]));
    expect(drawn(without[1]), "layers drawn at the loft").toEqual(expect.arrayContaining(["ghosts", "deckFloors", "walls"]));
    for (const { value } of SURROUNDINGS_VALUES) expect(scenes(layered({ type: "setProjectField", key: "surroundings", value })), value).toEqual(without);
  });
});
