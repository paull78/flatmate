import { describe, expect, it } from "vitest";
import { UNDERLAY_ID, execute, underlayRect, type Box, type Command, type Document, type Underlay } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, type Camera } from "../src/camera";
import { createLocalDocument } from "../src/document/local-document";
import type { UnderlayImport } from "../src/ports/events";
import { UNDERLAY_REFUSALS } from "../src/underlay";
import { roomDoc, underlayCommand, underlayDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The import action (import.06, .15, .16; AC-01, AC-06, AC-13): a decoded picture lands at the view's top-left as
// one undoable put; a refusal is a toast naming the supported types.

const picture = (width: number, height: number, data = "QUFB"): UnderlayImport => ({ ok: true, data, width, height });
const importing = (shell: FakeShell, result: UnderlayImport): void => shell.ui({ type: "importUnderlay", result });

function row(doc: Document): Underlay {
  const u = doc.underlays[UNDERLAY_ID];
  if (!u) throw new Error("no underlay row");
  return u;
}

/** The rectangle's four corners. */
function corners(r: Box): Point[] {
  return [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }];
}

function rect(doc: Document) {
  const r = underlayRect(doc);
  if (!r) throw new Error("no underlay rect");
  return r;
}

describe("importUnderlay places the picture (AC-01)", () => {
  it("AC-01: an imported picture lands with its top-left at the view's top-left, 0.01 m/px, unscaled", () => {
    const shell = FakeShell.local(); // 1200 × 800 at zoom 80, centred on (3, 2)
    importing(shell, picture(300, 120));
    const u = row(shell.doc());
    expect(Object.keys(shell.doc().underlays)).toEqual([UNDERLAY_ID]);
    expect(u.at.x).toBeCloseTo(3 - 600 / 80, 9);
    expect(u.at.y).toBeCloseTo(2 + 400 / 80, 9);
    expect(u.metresPerPixel).toBe(0.01);
    expect(u.scaled).toBe(false);
    expect(u.mime).toBe("image/jpeg");
    expect([u.width, u.height]).toEqual([300, 120]);
    const r = rect(shell.doc());
    expect(r.minX).toBeCloseTo(-4.5, 9);
    expect(r.maxX).toBeCloseTo(-1.5, 9);
    expect(r.maxY).toBeCloseTo(7, 9);
    expect(r.minY).toBeCloseTo(5.8, 9);
  });

  it("AC-01: after a pan and a zoom off centre, the picture lands at the new top-left", () => {
    const shell = FakeShell.local();
    shell.moveTo({ x: 1.37, y: -0.81 });
    shell.wheel(0, -30, { ctrl: true });
    shell.wheel(37, 23);
    const camera = shell.state.camera;
    importing(shell, picture(120, 340));
    const u = row(shell.doc());
    expect(u.at).toEqual(screenToWorld(camera, { x: 0, y: 0 }));
    expect(Math.hypot(u.at.x + 4.5, u.at.y - 7)).toBeGreaterThan(0.1);
    const r = rect(shell.doc());
    const corner = worldToScreen(camera, { x: r.minX, y: r.maxY });
    expect(Math.abs(corner.x)).toBeLessThan(1e-6);
    expect(Math.abs(corner.y)).toBeLessThan(1e-6);
    expect(r.maxX - r.minX).toBeCloseTo(1.2, 9);
    expect(r.maxY - r.minY).toBeCloseTo(3.4, 9);
  });

  it("AC-01 fuzz: across 300 seeded random cameras the picture's top-left maps to screen (0,0)", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647; // Park–Miller, reproducible
    const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
    const shell = FakeShell.local();
    for (let i = 0; i < 300; i++) {
      const zoom = between(MIN_ZOOM, MAX_ZOOM);
      const center = { x: between(-500, 500), y: between(-500, 500) };
      const viewport = { width: Math.round(between(300, 2500)), height: Math.round(between(200, 1600)) };
      const width = 1 + Math.floor(random() * 2000);
      const height = 1 + Math.floor(random() * 2000);
      const camera = { center, zoom, viewport, dpr: 1 };
      shell.state = { ...shell.state, camera };
      importing(shell, picture(width, height));
      const label = `case ${i}: zoom ${zoom} centre ${center.x},${center.y} viewport ${viewport.width}×${viewport.height} picture ${width}×${height}`;
      const r = rect(shell.doc());
      const corner = worldToScreen(camera, { x: r.minX, y: r.maxY });
      const tolerance = 1e-6 * Math.max(1, zoom);
      expect(Math.abs(corner.x), label).toBeLessThan(tolerance);
      expect(Math.abs(corner.y), label).toBeLessThan(tolerance);
      expect(r.maxX - r.minX, label).toBeCloseTo(width * 0.01, 9);
      expect(r.maxY - r.minY, label).toBeCloseTo(height * 0.01, 9);
      // Then the view shows all of it (AC-09): the smallest viewport leaves 204 × 104 px, so 20 m needs zoom ≥ 5.2.
      for (const p of corners(r)) {
        const q = worldToScreen(shell.state.camera, p);
        expect(q.x, label).toBeGreaterThanOrEqual(-0.5);
        expect(q.y, label).toBeGreaterThanOrEqual(-0.5);
        expect(q.x, label).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(q.y, label).toBeLessThanOrEqual(viewport.height + 0.5);
      }
    }
  });
});

describe("framing after an import (AC-09)", () => {
  it("AC-09: a 2000 × 1500 px picture frames itself in the importing view", () => {
    const shell = FakeShell.local(); // the view spans x −4.5…10.5, y −3…7
    importing(shell, picture(2000, 1500));
    const u = row(shell.doc());
    expect(u.at.x).toBeCloseTo(-4.5, 9);
    expect(u.at.y).toBeCloseTo(7, 9);
    const r = rect(shell.doc());
    expect([r.minX, r.maxX, r.minY, r.maxY].map((v) => Number(v.toFixed(9)))).toEqual([-4.5, 15.5, -8, 7]);
    const camera = shell.state.camera;
    expect(camera.zoom).toBeCloseTo(704 / 15, 9); // (800 − 2 × 48) px over 15 m
    expect(camera.center.x).toBeCloseTo(5.5, 9);
    expect(camera.center.y).toBeCloseTo(-0.5, 9);
    const screen = corners(r).map((p) => worldToScreen(camera, p));
    for (const q of screen) {
      expect(Math.min(Math.abs(q.x - (600 - 7040 / 15)), Math.abs(q.x - (600 + 7040 / 15)))).toBeLessThan(1e-6);
      expect(Math.min(Math.abs(q.y - 48), Math.abs(q.y - 752))).toBeLessThan(1e-6);
    }
  });

  it("AC-09: a picture that already fits leaves the camera unchanged", () => {
    const fits = (width: number, height: number): boolean => {
      const shell = FakeShell.local();
      const before = shell.state.camera;
      importing(shell, picture(width, height));
      expect(row(shell.doc()).width).toBe(width);
      return JSON.stringify(shell.state.camera) === JSON.stringify(before);
    };
    const shell = FakeShell.local();
    const before = shell.state.camera;
    importing(shell, picture(300, 120));
    expect(shell.state.camera).toEqual(before);
    expect(fits(1500, 10)).toBe(true); // 15.00 m: the right edge at exactly screen x 1200
    expect(fits(10, 1000)).toBe(true);
    expect(fits(10, 1001)).toBe(false);

    const wide = FakeShell.local();
    importing(wide, picture(1501, 10));
    expect(wide.state.camera.zoom).toBeCloseTo(1104 / 15.01, 9);
    expect(wide.state.camera.center.x).toBeCloseTo(3.005, 9);
    expect(wide.state.camera.center.y).toBeCloseTo(6.95, 9);
  });

  it("AC-01, AC-09: a framed picture shows even if the last one was hidden", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    shell.ui({ type: "toggleUnderlay" });
    expect(shell.state.underlayView.visible).toBe(false);
    importing(shell, picture(2000, 1500));
    expect(shell.state.camera.zoom).toBeCloseTo(704 / 15, 9);
    expect(shell.state.underlayView.visible).toBe(true);
  });

  it("AC-09: framing replays the pointer", () => {
    const shell = FakeShell.local();
    shell.moveTo({ x: 1, y: 1 });
    importing(shell, picture(2000, 1500));
    const pointer = shell.state.pointer;
    if (!pointer) throw new Error("no pointer");
    expect(shell.state.camera.zoom).toBeCloseTo(704 / 15, 9);
    expect(pointer.world).toEqual(screenToWorld(shell.state.camera, pointer.screen));
  });

  it("AC-09: another browser's camera never moves", () => {
    const r = FakeRemote.open(roomDoc());
    const before = r.shell.state.camera;
    r.remote(underlayCommand({ width: 2000, height: 1500 }));
    expect(r.shell.doc().underlays[UNDERLAY_ID]?.width).toBe(2000);
    expect(r.shell.state.camera).toEqual(before);
  });

  it("AC-09: the importing server-mode browser frames on submit and keeps it on accept", () => {
    const r = FakeRemote.open(roomDoc());
    importing(r.shell, picture(2000, 1500));
    const framed = r.shell.state.camera;
    expect(framed.zoom).toBeCloseTo(704 / 15, 9);
    r.accept();
    expect(r.shell.state.camera).toEqual(framed);
  });

  it("refused or blocked imports never move the camera", () => {
    const r = FakeRemote.open(roomDoc());
    const before = r.shell.state.camera;
    importing(r.shell, { ok: false, reason: "unsupported" });
    expect(r.shell.state.camera).toEqual(before);
    r.disconnect();
    importing(r.shell, picture(2000, 1500));
    expect(r.shell.view().toast).toBe("Offline: editing resumes when the connection returns");
    expect(r.shell.state.camera).toEqual(before);
  });
});

describe("a second picture replaces the first (AC-06)", () => {
  /** A scaled first picture, then a pan and a second, taller picture; returns both rows and the camera it landed in. */
  function replaced(): { shell: FakeShell; first: Underlay; second: Underlay; cameraBefore: Camera } {
    const shell = FakeShell.local();
    importing(shell, picture(300, 120));
    const scale: Command = { type: "scaleUnderlay", a: { x: -3.71, y: 6.43 }, b: { x: -2.13, y: 6.07 }, distance: 2.9 };
    shell.command(scale);
    const first = row(shell.doc());
    expect(first.scaled).toBe(true);
    shell.wheel(-53, 41);
    const cameraBefore = shell.state.camera;
    importing(shell, picture(120, 340, "QkJC"));
    return { shell, first, second: row(shell.doc()), cameraBefore };
  }

  it("AC-06: a second picture replaces the first in one edit, fresh at the view's top-left", () => {
    const { shell, first, second, cameraBefore } = replaced();
    expect(Object.keys(shell.doc().underlays)).toEqual(["underlay"]);
    expect(second.pictureId).not.toBe(first.pictureId);
    expect(second.data).toBe("QkJC");
    expect([second.width, second.height]).toEqual([120, 340]);
    expect(second.scaled).toBe(false);
    expect(second.metresPerPixel).toBe(0.01);
    expect(second.at).toEqual(screenToWorld(cameraBefore, { x: 0, y: 0 }));
  });

  it("AC-06: one Undo brings back the first picture with its scale", () => {
    const { shell, first, second } = replaced();
    shell.ui({ type: "undo" });
    expect(row(shell.doc())).toEqual(first);
    expect(row(shell.doc()).scaled).toBe(true);
    shell.ui({ type: "redo" });
    expect(row(shell.doc())).toEqual(second);
  });

  it("AC-06: a replace is one put of underlays/underlay that expects its version", () => {
    const remote = FakeRemote.open(underlayDoc());
    importing(remote.shell, picture(120, 340, "QkJC"));
    const { patch, expect: expected } = remote.last();
    expect(patch.puts.map((p) => ({ table: p.table, id: p.entity.id }))).toEqual([{ table: "underlays", id: "underlay" }]);
    expect(patch.deletes).toEqual([]);
    expect(expected).toContainEqual(expect.objectContaining({ table: "underlays", id: "underlay" }));
  });

  it("AC-06: Remove deletes the underlay and Undo brings it back", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    const original = row(shell.doc());
    shell.ui({ type: "removeUnderlay" });
    expect(shell.doc().underlays).toEqual({});
    shell.ui({ type: "undo" });
    expect(row(shell.doc())).toEqual(original);
  });

  it("Remove with no underlay toasts the domain refusal and changes nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const before = shell.doc();
    const refused = execute(roomDoc(), { type: "removeUnderlay" });
    if (refused.ok) throw new Error("removeUnderlay should refuse without a row");
    shell.ui({ type: "removeUnderlay" });
    expect(shell.view().toast).toBe(refused.error.message);
    expect(shell.doc()).toBe(before);
    expect(shell.view().canUndo).toBe(false);
  });
});

describe("refusals and edge cases (AC-13)", () => {
  const texts = {
    unsupported: "Not a picture: use a PNG, JPEG, WebP or GIF (export a PDF page as an image)",
    unreadable: "Couldn't read this picture: use a PNG, JPEG, WebP or GIF",
    tooLarge: "This picture is too detailed to fit: crop it or use a smaller PNG, JPEG, WebP or GIF",
  } as const;

  it.each(["unsupported", "unreadable", "tooLarge"] as const)("AC-13: the %s refusal toasts its text naming PNG, JPEG, WebP and GIF, and nothing changes", (reason) => {
    const remote = FakeRemote.open(roomDoc());
    const before = remote.shell.doc();
    const submits = remote.submits().length;
    importing(remote.shell, { ok: false, reason });
    expect(remote.shell.view().toast).toBe(texts[reason]);
    expect(UNDERLAY_REFUSALS[reason]).toContain("PNG, JPEG, WebP or GIF");
    expect(remote.shell.doc()).toBe(before);
    expect(remote.submits()).toHaveLength(submits);
    expect(remote.shell.view().canUndo).toBe(false);
  });

  it("with no document open, an import does nothing", () => {
    const remote = FakeRemote.open();
    remote.shell.ui({ type: "showProjectList" });
    const before = remote.shell.state;
    expect(before.document).toBeNull();
    for (const result of [picture(300, 120), { ok: false, reason: "unsupported" } satisfies UnderlayImport]) {
      const effects = remote.shell.send({ type: "ui", action: { type: "importUnderlay", result } });
      expect(effects.map((e) => e.type)).toEqual(["render"]);
      expect(remote.shell.state.document).toBe(before.document);
      expect(remote.shell.state.toast).toBe(before.toast);
      expect(remote.shell.state.undo).toBe(before.undo);
    }
  });

  it("while the editor can't commit, an import toasts the blocked message and submits nothing", () => {
    const remote = FakeRemote.open(roomDoc());
    remote.event({ type: "connection", state: "closed" });
    const submits = remote.submits().length;
    importing(remote.shell, picture(300, 120));
    expect(remote.shell.view().toast).toBe("Offline: editing resumes when the connection returns");
    expect(remote.submits()).toHaveLength(submits);
    expect(remote.shell.doc().underlays).toEqual({});
  });

  it("an import that arrives after the user switched drawings lands in the open one (accepted)", () => {
    const shell = FakeShell.local();
    shell.state = { ...shell.state, document: createLocalDocument({ id: "other", name: "Other" }, "g2", roomDoc()) };
    importing(shell, picture(300, 120));
    expect(shell.state.document?.project.id).toBe("other");
    expect(row(shell.doc()).width).toBe(300);
  });
});
