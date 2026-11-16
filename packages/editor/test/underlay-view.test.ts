import { describe, expect, it } from "vitest";
import { UNDERLAY_ID, underlayRect } from "@fm/domain";
import { roomDoc, underlayCommand, underlayDoc, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The underlay in the Scene and the ViewModel (import.06, .11, .17; AC-05): the Scene carries the row's picture and
// rectangle beside its layers; fade and show/hide are this viewer's, never synced or undone.

describe("Scene.underlay (import.11)", () => {
  it("the Scene's underlay is the row's picture, rect and fade", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    const doc = shell.doc();
    const u = shell.scene().underlay;
    expect(u?.pictureId).toBe("pic1");
    expect(u?.data).toBe(doc.underlays[UNDERLAY_ID]?.data);
    expect(u?.rect).toEqual(underlayRect(doc));
    expect(u?.rect.minX).toBeCloseTo(-1.373, 9);
    expect(u?.rect.maxX).toBeCloseTo(1.627, 9);
    expect(u?.rect.maxY).toBeCloseTo(5.217, 9);
    expect(u?.rect.minY).toBeCloseTo(4.017, 9);
    expect(u?.fade).toBe(0.5);
  });

  it("no row or hidden → scene.underlay is null; the layers are the same as without an underlay", () => {
    expect(FakeShell.withDocument(roomDoc()).scene().underlay).toBeNull();
    const shell = FakeShell.withDocument(underlayDoc());
    const layers = shell.scene().layers;
    shell.ui({ type: "toggleUnderlay" });
    expect(shell.scene().underlay).toBeNull();
    expect(layers).toEqual(FakeShell.withDocument(roomDoc()).scene().layers);
  });

  it("the scene reads the underlay from the visible document during a Wall preview", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    const before = underlayRect(shell.doc());
    shell.ui({ type: "pickTool", tool: "wall" });
    shell.click({ x: 0.5, y: 0.5 });
    shell.moveTo({ x: 2.3, y: 0.7 });
    expect(shell.state.tool.name === "wall" && shell.state.tool.state.kind).toBe("drawing");
    const u = shell.scene().underlay;
    expect(u?.pictureId).toBe("pic1");
    expect(u?.rect).toEqual(before);
    expect(before).not.toBeNull();
  });
});

describe("fade and show/hide are per viewer (AC-05)", () => {
  it("AC-05: fade and show/hide change only this viewer", () => {
    const remote = FakeRemote.open(underlayDoc());
    const before = remote.shell.doc();
    const submits = remote.submits().length;
    remote.shell.ui({ type: "setUnderlayFade", fade: 0.8 });
    remote.shell.ui({ type: "toggleUnderlay" });
    expect(remote.shell.state.underlayView).toEqual({ fade: 0.8, visible: false });
    expect(remote.shell.doc()).toBe(before);
    expect(remote.submits()).toHaveLength(submits);
  });

  it("AC-05: Undo skips fade and show/hide", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "importUnderlay", result: { ok: true, data: "QUFB", width: 300, height: 120 } });
    shell.ui({ type: "setUnderlayFade", fade: 0.25 });
    shell.ui({ type: "toggleUnderlay" });
    shell.ui({ type: "undo" });
    expect(shell.doc().underlays).toEqual({});
    expect(shell.state.underlayView).toEqual({ fade: 0.25, visible: false });
    shell.ui({ type: "redo" });
    expect(shell.doc().underlays[UNDERLAY_ID]).toBeDefined();
    expect(shell.scene().underlay).toBeNull(); // still hidden
    shell.ui({ type: "toggleUnderlay" });
    expect(shell.scene().underlay?.fade).toBe(0.25);
  });

  it("a new picture shows even if the last one was hidden, keeping the fade (AC-01)", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    shell.ui({ type: "setUnderlayFade", fade: 0.3 });
    shell.ui({ type: "toggleUnderlay" });
    shell.ui({ type: "removeUnderlay" });
    shell.ui({ type: "importUnderlay", result: { ok: true, data: "QkJC", width: 120, height: 340 } });
    expect(shell.scene().underlay?.fade).toBe(0.3);
    shell.ui({ type: "toggleUnderlay" });
    shell.ui({ type: "importUnderlay", result: { ok: false, reason: "unreadable" } });
    expect(shell.state.underlayView.visible).toBe(false); // a refusal changes nothing
  });

  it("setUnderlayFade clamps to 0..1 and ignores a non-number", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    const fade = (value: number): number => {
      shell.ui({ type: "setUnderlayFade", fade: value });
      return shell.state.underlayView.fade;
    };
    expect(fade(1.7)).toBe(1);
    expect(fade(-0.2)).toBe(0);
    expect(fade(0.4)).toBe(0.4);
    expect(fade(Number.NaN)).toBe(0.4);
    expect(fade(Number.POSITIVE_INFINITY)).toBe(0.4);
    expect(fade(Number.NEGATIVE_INFINITY)).toBe(0.4);
  });
});

describe("ViewModel.underlay (the Underlay section)", () => {
  it("the Underlay section shows with nothing selected, never with a selection or no drawing", () => {
    expect(FakeShell.withDocument(roomDoc()).view().underlay).toEqual({ present: false, canEdit: true, fade: 0.5, visible: true });
    expect(FakeShell.withDocument(underlayDoc()).view().underlay?.present).toBe(true);

    const selected = FakeShell.withDocument(underlayDoc());
    selected.state = { ...selected.state, selection: [{ table: "walls", id: wallBetween(selected.doc(), { x: 0, y: 0 }, { x: 6, y: 0 }) }] };
    expect(selected.view().underlay).toBeNull();

    const list = FakeRemote.open(underlayDoc());
    list.shell.ui({ type: "showProjectList" });
    expect(list.shell.state.document).toBeNull();
    expect(list.shell.view().underlay).toBeNull();

    const offline = FakeRemote.open(underlayDoc());
    offline.event({ type: "connection", state: "closed" });
    expect(offline.shell.view().underlay).toEqual({ present: true, canEdit: false, fade: 0.5, visible: true });
  });

  it("the ViewModel never carries the picture's data", () => {
    const marker = "UNDERLAYMARKER" + "A".repeat(5000);
    const shell = FakeShell.withDocument(withCommands(roomDoc(), underlayCommand({ data: marker })));
    expect(shell.doc().underlays[UNDERLAY_ID]?.data).toBe(marker);
    expect(JSON.stringify(shell.view())).not.toContain("UNDERLAYMARKER");
  });
});
