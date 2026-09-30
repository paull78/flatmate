import type { Camera, Scene, ViewModel } from "@fm/editor";

export const cameraFixture: Camera = {
  center: { x: 0, y: 0 },
  zoom: 100,
  viewport: { width: 200, height: 100 },
  dpr: 2,
};

export function sceneFixture(): Scene {
  const names = ["grid", "zoneFills", "walls", "tags", "annotations", "overlays", "presence"] as const;
  return { layers: names.map((name) => ({ name, primitives: [] })) };
}

export function viewFixture(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    activeTool: "select",
    commandBar: { prompt: "Select", value: "", unit: null },
    properties: { kind: "none" },
    cursor: "default",
    snap: null,
    presence: [],
    project: { name: "Untitled", status: "not saved", dirty: false, canEdit: true },
    projectList: null,
    toast: null,
    canUndo: false,
    canRedo: false,
    ...overrides,
  };
}
