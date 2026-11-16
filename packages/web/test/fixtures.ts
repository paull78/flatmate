import type { Camera, Scene, ViewModel } from "@fm/editor";

export const cameraFixture: Camera = {
  center: { x: 0, y: 0 },
  zoom: 100,
  viewport: { width: 200, height: 100 },
  dpr: 2,
};

export function sceneFixture(): Scene {
  const names = ["grid", "ghosts", "finishes", "zoneFills", "decks", "objects", "overheads", "warnings", "walls", "openings", "deckLabels", "tags", "dimensions", "annotations", "overlays", "presence"] as const;
  return { layers: names.map((name) => ({ name, primitives: [] })), underlay: null };
}

export function viewFixture(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    activeTool: "select",
    commandBar: { prompt: "Select", value: "", unit: null, chips: [] },
    typing: false,
    properties: { kind: "none" },
    cursor: "default",
    snap: null,
    presence: [],
    project: { name: "Untitled", status: "not saved", dirty: false, canEdit: true },
    projectList: null,
    toast: null,
    canUndo: false,
    canRedo: false,
    wallThickness: "0.20",
    states: [{ id: "s0", name: "Layout", active: true }],
    warnings: { rows: [], blink: 0 },
    objectKind: "bed",
    sizePicker: null,
    sizeFields: null,
    openingKind: "swing",
    tools: [{ tool: "select", label: "Select", key: "V" }, { tool: "wall", label: "Wall", key: "W" }, { tool: "zone", label: "Zone", key: "Z" }, { tool: "object", label: "Object", key: "O" }, { tool: "opening", label: "Opening", key: "D" }, { tool: "dimension", label: "Dimension", key: "M" }, { tool: "section", label: "Section", key: "S" }, { tool: "column", label: "Column", key: "C" }, { tool: "deck", label: "Deck", key: "K" }],
    openingKinds: [{ kind: "swing", label: "Swing door", group: "Doors" }, { kind: "sliding", label: "Sliding door", group: "Doors" }, { kind: "window", label: "Fixed window", group: "Windows" }, { kind: "casement", label: "Casement window", group: "Windows" }],
    deckPreset: "platform",
    deckPresets: [{ preset: "platform", label: "Platform" }, { preset: "loft", label: "Loft" }],
    columnSize: { width: "0.30", depth: "0.30" },
    columnSizes: [{ width: "0.20", depth: "0.20", label: "20" }, { width: "0.30", depth: "0.30", label: "30" }, { width: "0.40", depth: "0.40", label: "40" }],
    palette: [{ group: "Sleep", cards: [{ kind: "bed", preset: null, name: "Bed", size: "1.60 × 2.00 m", config: "standard", w: 1.6, d: 2 }] }],
    toolHelp: { tool: "select", label: "Select", key: "V", hint: "Select" },
    shortcuts: [{ label: "Select", key: "V" }, { label: "Wall", key: "W" }],
    gridStep: 0.2,
    cut: null,
    levels: null,
    ceiling: null,
    outside: null,
    trailer: null,
    view3d: null,
    sectionStrip: null,
    sectionMarks: null,
    frames: { height: 0.46, larger: false, sectionShare: 0.56, sectionFirst: true, docked: false, side: false },
    snapStep: "auto",
    snapSteps: [
      { step: "auto", label: "Auto" }, { step: 0.01, label: "1" }, { step: 0.05, label: "5" },
      { step: 0.1, label: "10" }, { step: 0.25, label: "25" }, { step: 0.5, label: "50" },
    ],
    export: null,
    sheetsView: null,
    projectFields: null,
    underlay: null,
    underPointer: null,
    logo: null,
    rooms: null,
    floors: { on: true, tiles: [{ motif: "planks", label: "Planks", w: 1.92, d: 1.2 }], armed: null },
    ...overrides,
  };
}
