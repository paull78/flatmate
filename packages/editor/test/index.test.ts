import { describe, expect, it } from "vitest";
import * as editor from "../src/index";
import type * as api from "../src/index";
import { FakeHost } from "./fake-shell";

// Every type the public index exports, written once; the typecheck fails if one goes missing. The README `@fm/editor`
// contract and the phase 4 web shell import most of them. Module-internal contract types (Moves, SnapContext,
// SnapPolicy, CommandOutcome, CommitInputWithoutId) are not public.
// Exported only so lint counts it as used.
export type PublicTypes = [
  api.Align, api.Camera, api.Color, api.CommitInput, api.DocStep<unknown>, api.DocumentStatus, api.DragTarget,
  api.EditorState, api.Effect, api.Event, api.Field, api.FontSpec, api.HistoryState, api.Host, api.InitOptions,
  api.Layer, api.LayerName, api.LocalDocument, api.Mods, api.MoveAttempt, api.Notice, api.OpenDocument,
  api.PointerInput, api.Primitive, api.ProjectInfo, api.RemotePresence, api.Scene, api.SelectToolState,
  api.ServerEffect, api.ServerEvent, api.SharedDocument, api.Size, api.SnapshotEvent, api.SnapAxis, api.SnapCandidate, api.SnapKind, api.SnapResult, api.Step, api.ToolName,
  api.ToolState, api.UiAction, api.UndoEntry, api.UndoRequest, api.ViewModel, api.WallPreview, api.WallToolState,
  api.Width, api.WorkspaceEvent, api.WorkspaceOp, api.ZoneToolState,
];

describe("@fm/editor public API", () => {
  it("exports what the web shell needs", () => {
    for (const name of ["update", "initialState", "buildViewModel", "buildScene", "worldToScreen", "screenToWorld"] as const) {
      expect(typeof editor[name]).toBe("function");
    }
    expect(editor.COLORS.wall).toMatch(/^#/);
    expect(editor.UI_FONT).toContain("sans-serif");
    expect([editor.TAG_FONT.family, editor.HELPER_FONT.family]).toEqual([editor.UI_FONT, editor.UI_FONT]);
    expect(editor.NO_MODS.shift).toBe(false);
  });

  it("exports the wire mapping the WebSocket adapter uses", () => {
    expect(typeof editor.clientMessageFor).toBe("function");
    expect(typeof editor.serverMessageEvent).toBe("function");
  });

  it("exports the shared-document queries and the notice texts other hosts match on", () => {
    for (const name of ["sharedFromSnapshot", "hasPendingEdit", "sessionOf", "visibleDoc"] as const) {
      expect(typeof editor[name]).toBe("function");
    }
    const texts = [
      editor.REMOTE_UNDO, editor.REMOTE_REDO, editor.CHAIN_ENDED, editor.CONNECTION_LOST, editor.GESTURE_CANCELLED,
      editor.LEAVE_BLOCKED, editor.NAME_REQUIRED, editor.OFFLINE_LIST,
    ];
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
  });

  it("exports the helper placement and area format for other hosts (phase 8's Playwright driver)", () => {
    expect(typeof editor.helperLabelAt).toBe("function");
    expect(editor.formatArea(10.64)).toBe("10.64 m²");
  });

  it("offers no way to change state except update: no document, history or camera writes", () => {
    for (const name of ["commit", "onEvent", "createLocalDocument", "emptyHistory", "zoomAt", "panBy", "runCommand"]) {
      expect(name in editor, name).toBe(false);
    }
  });

  it("runs headless through the public API alone", () => {
    const host = new FakeHost();
    const opts = { mode: "local", me: { clientId: "t", name: "A" }, viewport: { width: 800, height: 600 }, dpr: 1 } as const;
    const r = editor.update(editor.initialState(opts, host), { type: "key", key: "w", mods: editor.NO_MODS }, host);
    expect(r.state.tool.name).toBe("wall");
    expect(r.effects.at(-1)?.type).toBe("render");
  });
});
