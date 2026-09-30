# Phase 4: Web shell with Canvas2D (no server)

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** Run the headless editor from phase 3 in the browser. DOM input becomes editor events, effects become Canvas2D frames and timers, and React panels render the ViewModel. It runs on one unsaved `LocalDocument` with no server and no project list.

**Spec:** §5.2 (ports and web adapters), §5.4 (global input), §5.9 (Scene and ViewModel), §6 and §6.1 (Renderer port, Canvas2D), §7.0 (`dirty` and the before-close warning), §10 step 4.

**Prerequisites:** G3 approved. `@fm/editor` exports the names listed under [Contract extensions](#contract-extensions) item 4. Node 22 and pnpm 10.

**Design memory to read first:**
- `architecture.md`. Don't: let shells precompute world coordinates, or put async work in `Host`. Panels send `ui` events and never change state.
- `editor-interaction.md`. Pointer events carry screen coordinates only. `Space` never pans; it confirms. `Shift` means orthogonal and `Ctrl` bypasses snapping. Pan is middle-drag or trackpad scroll; zoom is `Ctrl`/pinch + wheel.
- `rendering.md`. Canvas2D is demo-critical; text always stays on Canvas2D. Don't: let the demo depend on WebGL.
- `open-documents.md`. `dirty` drives the before-close warning. Don't: build the discard prompt.

The shell stays thin. It holds no UI logic beyond turning DOM input into events, running effects and rendering the ViewModel. If a panel or adapter seems to need editor internals, stop, record it in the sprint log, and extend the ViewModel or `Scene` in `@fm/editor` instead.

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/web/package.json` | `@fm/web` package, scripts `dev`, `test`, `typecheck`, `e2e` |
| Create | `packages/web/tsconfig.json` | App sources: `lib` DOM, `jsx: react-jsx`, `types: ["vite/client"]` |
| Create | `packages/web/tsconfig.node.json` | Tests, e2e and config files: DOM lib plus Node types |
| Create | `packages/web/vite.config.ts` | Vite + React plugin, port 5173 |
| Create | `packages/web/vitest.config.ts` | Node environment, React plugin for JSX, `test/**` only |
| Create | `packages/web/playwright.config.ts` | Chromium project and Vite `webServer` |
| Create | `packages/web/index.html` | `#root` mount point |
| Create | `packages/web/src/adapters/web-host.ts` | `Host`: OffscreenCanvas `measureText`, `performance.now`, `crypto.randomUUID` |
| Create | `packages/web/src/adapters/timers.ts` | `startTimer`/`cancelTimer` → `setTimeout`; fires `timerFired` |
| Create | `packages/web/src/adapters/input.ts` | Pure DOM → editor event mapping, plus `attachInput` wiring |
| Create | `packages/web/src/adapters/renderer.ts` | `Renderer` port (spec §6) |
| Create | `packages/web/src/adapters/canvas2d-renderer.ts` | `drawPrimitive`, `drawScene`, `backingSize`, rAF-coalesced `createCanvas2DRenderer` |
| Create | `packages/web/src/adapters/effect-runner.ts` | `switch (effect.type)` → renderer, timers, server sink |
| Create | `packages/web/src/store.ts` | Holds `EditorState`; queued `dispatch`; view subscription for React |
| Create | `packages/web/src/identity.ts` | Display name from `?name=` (default "Guest") |
| Create | `packages/web/src/panels/types.ts` | `PanelProps` |
| Create | `packages/web/src/panels/Toolbar.tsx` | Tool buttons + undo/redo → `ui` events |
| Create | `packages/web/src/panels/CommandBar.tsx` | Prompt, typed value, unit |
| Create | `packages/web/src/panels/PropertiesPanel.tsx` | Fields; editable ones send `setField` |
| Create | `packages/web/src/panels/StatusBar.tsx` | Project name, status, collaborators list |
| Create | `packages/web/src/panels/Toast.tsx` | Toast text |
| Create | `packages/web/src/app.tsx` | Layout; mounts the canvas through an injected `mountCanvas` |
| Create | `packages/web/src/main.tsx` | Composition root, local mode |
| Create | `packages/web/src/styles.css` | Light theme, layout |
| Create | `packages/web/test/fixtures.ts` | `viewFixture`, `sceneFixture`, `cameraFixture` |
| Test | `packages/web/test/*.test.ts(x)` | Adapter, store and panel tests (Node environment) |
| Test | `packages/web/e2e/smoke.spec.ts` | Playwright smoke: draw the demo room, read a wall's length |
| Modify | root `package.json` | `dev` and `e2e` scripts |
| Modify | `eslint.config.js`, `.gitignore` | Ignore Vite and Playwright output |

---

## Tasks

### Task 4.1: Scaffold `@fm/web`

**Files:** create `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/tsconfig.node.json`, `packages/web/vite.config.ts`, `packages/web/vitest.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx` (placeholder) and `packages/web/test/scaffold.test.ts`. Modify root `package.json`, `eslint.config.js` and `.gitignore`.

- [x] **Step 1: Create the package manifest**

`packages/web/package.json`:

```json
{
  "name": "@fm/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "e2e": "playwright test"
  }
}
```

- [x] **Step 2: Install dependencies (unpinned; pnpm records the resolved versions)**

```bash
pnpm --filter @fm/web add react react-dom @fm/editor@workspace:* @fm/protocol@workspace:*
pnpm --filter @fm/web add -D vite @vitejs/plugin-react @types/react @types/react-dom @types/node vitest typescript
```

Expected: `packages/web/package.json` gains `dependencies` and `devDependencies`. If phase 1 installed `vitest` and `typescript` at the root, pnpm reuses the same versions.

- [x] **Step 3: TypeScript configs**

`packages/web/tsconfig.json` covers the app sources, which run in the browser:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`packages/web/tsconfig.node.json` covers tests, e2e and the config files, which run in Node but import DOM-typed sources:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["test", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [x] **Step 4: Vite and Vitest configs, HTML entry**

`packages/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
```

`packages/web/vitest.config.ts`: adapter and panel tests run in Node. The React plugin configures the automatic JSX runtime, whatever transformer Vite uses (Vite 8 uses oxc, not esbuild). If typecheck reports a `Plugin` type mismatch between `vitest/config` and `@vitejs/plugin-react`, two Vite versions are installed; align them with `pnpm why vite`.

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
```

`packages/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flatmate</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/main.tsx` is a placeholder until Task 4.11:

```tsx
const root = document.getElementById("root");
if (root !== null) root.textContent = "Flatmate";
```

- [x] **Step 5: Write the wiring test**

`packages/web/test/scaffold.test.ts`: the web package resolves the editor core from its TypeScript sources (README decision P1).

```ts
import { describe, expect, it } from "vitest";
import { initialState, type Host } from "@fm/editor";

const host: Host = {
  textMetrics: (text, font) => ({ width: text.length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
  now: () => 0,
  newId: () => "id1",
};

describe("@fm/web wiring", () => {
  it("creates a local editor state through the workspace package", () => {
    const state = initialState(
      { mode: "local", me: { clientId: "c1", name: "Guest" }, viewport: { width: 800, height: 600 }, dpr: 1 },
      host,
    );
    expect(state.document?.kind).toBe("local");
    expect(state.tool.name).toBe("select");
  });
});
```

- [x] **Step 6: Run it**

Run: `pnpm --filter @fm/web test`
Expected: PASS, 1 test. This task checks the wiring; it adds no new logic. A failure here means package resolution is broken: check `"exports"` in `packages/editor/package.json` (README P1).

- [x] **Step 7: Root scripts and ignores**

In the root `package.json` `scripts`, add or replace these two keys:

```json
"dev": "pnpm --filter @fm/web dev",
"e2e": "pnpm --filter @fm/web e2e"
```

In `eslint.config.js`, add these entries to the top-level `ignores` array:

```js
"packages/web/dist/**",
"packages/web/test-results/**",
"packages/web/playwright-report/**",
```

Append to `.gitignore`:

```
packages/web/dist/
packages/web/test-results/
packages/web/playwright-report/
```

- [x] **Step 8: Check the dev server by hand**

Run `pnpm dev`, open http://localhost:5173 and expect the text "Flatmate". Stop the server.

- [x] **Step 9: Verify and commit**

Run: `pnpm check`. Expected: pass; the web package's typecheck runs both configs.

```bash
git add packages/web package.json pnpm-lock.yaml eslint.config.js .gitignore
git commit -m "web: scaffold @fm/web with Vite, React and Vitest"
```

---

### Task 4.2: Web host adapter

**Files:** create `packages/web/src/adapters/web-host.ts`; test `packages/web/test/web-host.test.ts`.

`OffscreenCanvas` does not exist in Node, so only the font-string helper is unit-tested. `createWebHost` is exercised by the e2e test and by hand. The same font string must be used here and by the renderer (Task 4.6), or zone-tag hit boxes (phase 5) will not match the drawn text.

- [x] **Step 1: Write the failing test**

`packages/web/test/web-host.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fontString } from "../src/adapters/web-host";

describe("fontString", () => {
  it("defaults the weight to 400", () => {
    expect(fontString({ family: "Inter, system-ui, sans-serif", size: 12 })).toBe("400 12px Inter, system-ui, sans-serif");
  });

  it("keeps an explicit weight", () => {
    expect(fontString({ family: "Inter", size: 11, weight: 600 })).toBe("600 11px Inter");
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test web-host`
Expected: FAIL, because `../src/adapters/web-host` cannot be resolved.

- [x] **Step 3: Implement**

`packages/web/src/adapters/web-host.ts`:

```ts
import type { FontSpec, Host } from "@fm/editor";

type TextMetricsResult = { width: number; ascent: number; descent: number };

/** CSS font shorthand; the Canvas2D renderer draws text with the same string (weight 400). */
export function fontString(font: FontSpec): string {
  return `${font.weight ?? 400} ${font.size}px ${font.family}`;
}

const MAX_CACHE = 2000;

/** Browser Host: synchronous queries only (spec §5.2). */
export function createWebHost(): Host {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas 2D context unavailable");
  const cache = new Map<string, TextMetricsResult>();

  return {
    textMetrics(text: string, font: FontSpec): TextMetricsResult {
      const css = fontString(font);
      const key = `${css}|${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      ctx.font = css;
      const m = ctx.measureText(text);
      // Font-box metrics keep tag heights stable regardless of which glyphs a name contains.
      const result = { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
      if (cache.size >= MAX_CACHE) cache.clear();
      cache.set(key, result);
      return result;
    },
    now: () => performance.now(),
    newId: () => crypto.randomUUID(),
  };
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test web-host`
Expected: PASS, 2 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/web-host.ts packages/web/test/web-host.test.ts
git commit -m "web: browser Host adapter with cached text metrics"
```

---

### Task 4.3: Timers adapter

**Files:** create `packages/web/src/adapters/timers.ts`; test `packages/web/test/timers.test.ts`.

Starting a timer with an ID that is already running replaces it; the toast timer relies on this.

- [x] **Step 1: Write the failing test**

`packages/web/test/timers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event as EditorEvent } from "@fm/editor";
import { createTimers } from "../src/adapters/timers";

describe("timers adapter", () => {
  let fired: EditorEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches timerFired after the delay", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([{ type: "timerFired", timerId: "toast" }]);
  });

  it("fires each start once", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 100);
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveLength(1);
  });

  it("restarting a timer replaces the running one", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2000);
    timers.start("toast", 3000);
    vi.advanceTimersByTime(2000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([{ type: "timerFired", timerId: "toast" }]);
  });

  it("cancel prevents firing and ignores unknown IDs", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("toast", 100);
    timers.cancel("toast");
    timers.cancel("never-started");
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it("dispose cancels every timer", () => {
    const timers = createTimers((e) => fired.push(e));
    timers.start("a", 100);
    timers.start("b", 200);
    timers.dispose();
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test timers`
Expected: FAIL, because `../src/adapters/timers` cannot be resolved.

- [x] **Step 3: Implement**

`packages/web/src/adapters/timers.ts`:

```ts
import type { Event as EditorEvent } from "@fm/editor";

export type Timers = {
  start(id: string, ms: number): void;
  cancel(id: string): void;
  dispose(): void;
};

/** startTimer / cancelTimer effects → setTimeout; expiry comes back as a timerFired event (spec §5.2). */
export function createTimers(dispatch: (e: EditorEvent) => void): Timers {
  const handles = new Map<string, ReturnType<typeof setTimeout>>();

  function cancel(id: string): void {
    const handle = handles.get(id);
    if (handle === undefined) return;
    clearTimeout(handle);
    handles.delete(id);
  }

  return {
    start(id, ms) {
      cancel(id);
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          dispatch({ type: "timerFired", timerId: id });
        }, ms),
      );
    },
    cancel,
    dispose() {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
    },
  };
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test timers`
Expected: PASS, 5 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/timers.ts packages/web/test/timers.test.ts
git commit -m "web: timers adapter for startTimer/cancelTimer effects"
```

---

### Task 4.4: Input mapping helpers

**Files:** create `packages/web/src/adapters/input.ts` (pure helpers only; `attachInput` comes in Task 4.5); test `packages/web/test/input.test.ts`.

Decisions stated here:
- **Screen coordinates** are CSS pixels relative to the canvas's top-left corner. The editor converts them to world coordinates (spec §5.2; the shell never does).
- **Move button:** DOM pointer moves have `button === -1`. The held button comes from the `buttons` bitmask, and middle wins so that a middle-drag pans.
- **Digit keys with Shift held.** Demo step 2 types lengths while holding `Shift`. On a US layout `Shift+6` yields the key `"^"`, and other layouts produce other symbols. The adapter therefore maps the physical codes `Digit0`–`Digit9` and `Numpad0`–`Numpad9` to their digit, and `Period` and `NumpadDecimal` to `"."`, whatever the modifiers. Every other key passes through verbatim. This is recorded as a contract extension.
- **preventDefault** applies only to keys the browser would otherwise act on: `Space` (scroll), `Backspace` (history in some browsers), `Enter` (activating a focused control), and `Cmd`/`Ctrl` + `Z`/`Y`/`S`.

- [x] **Step 1: Write the failing test**

`packages/web/test/input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NO_MODS } from "@fm/editor";
import {
  canvasPoint,
  heldButton,
  isEditableTarget,
  keyEvent,
  normalizeKey,
  pointerEvent,
  pressButton,
  shouldPreventDefault,
  toMods,
  wheelEvent,
} from "../src/adapters/input";

const NO_DOM_MODS = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
const RECT = { left: 10, top: 20 };

describe("toMods", () => {
  it("maps DOM modifier flags", () => {
    expect(toMods({ shiftKey: true, ctrlKey: false, altKey: true, metaKey: false })).toEqual({
      shift: true,
      ctrl: false,
      alt: true,
      meta: false,
    });
  });
});

describe("buttons", () => {
  it("maps pressed buttons and ignores back/forward", () => {
    expect(pressButton(0)).toBe(0);
    expect(pressButton(1)).toBe(1);
    expect(pressButton(2)).toBe(2);
    expect(pressButton(3)).toBeNull();
    expect(pressButton(4)).toBeNull();
  });

  it("derives the held button during a move, middle first", () => {
    expect(heldButton(0)).toBe(0);
    expect(heldButton(1)).toBe(0);
    expect(heldButton(2)).toBe(2);
    expect(heldButton(4)).toBe(1);
    expect(heldButton(5)).toBe(1);
  });
});

describe("pointerEvent", () => {
  it("uses canvas-relative CSS pixels", () => {
    expect(canvasPoint({ clientX: 110, clientY: 70 }, RECT)).toEqual({ x: 100, y: 50 });
  });

  it("maps a left press", () => {
    const e = pointerEvent("pointerDown", { ...NO_DOM_MODS, clientX: 110, clientY: 70, button: 0, buttons: 1 }, RECT);
    expect(e).toEqual({ type: "pointerDown", screen: { x: 100, y: 50 }, mods: NO_MODS, button: 0 });
  });

  it("maps a middle press and carries Shift", () => {
    const e = pointerEvent("pointerDown", { ...NO_DOM_MODS, shiftKey: true, clientX: 10, clientY: 20, button: 1, buttons: 4 }, RECT);
    expect(e).toEqual({ type: "pointerDown", screen: { x: 0, y: 0 }, mods: { ...NO_MODS, shift: true }, button: 1 });
  });

  it("ignores back and forward buttons", () => {
    expect(pointerEvent("pointerDown", { ...NO_DOM_MODS, clientX: 0, clientY: 0, button: 3, buttons: 8 }, RECT)).toBeNull();
  });

  it("takes the move button from the buttons bitmask", () => {
    const e = pointerEvent("pointerMove", { ...NO_DOM_MODS, clientX: 20, clientY: 30, button: -1, buttons: 4 }, RECT);
    expect(e).toEqual({ type: "pointerMove", screen: { x: 10, y: 10 }, mods: NO_MODS, button: 1 });
    const hover = pointerEvent("pointerMove", { ...NO_DOM_MODS, clientX: 20, clientY: 30, button: -1, buttons: 0 }, RECT);
    expect(hover).toEqual({ type: "pointerMove", screen: { x: 10, y: 10 }, mods: NO_MODS, button: 0 });
  });
});

describe("wheelEvent", () => {
  it("passes pixel deltas through and keeps Ctrl (trackpad pinch)", () => {
    const e = wheelEvent({ ...NO_DOM_MODS, ctrlKey: true, clientX: 60, clientY: 70, deltaX: 0, deltaY: -12.5, deltaMode: 0 }, RECT);
    expect(e).toEqual({ type: "wheel", screen: { x: 50, y: 50 }, deltaX: 0, deltaY: -12.5, mods: { ...NO_MODS, ctrl: true } });
  });

  it("converts line deltas to pixels", () => {
    const e = wheelEvent({ ...NO_DOM_MODS, clientX: 10, clientY: 20, deltaX: 1, deltaY: 3, deltaMode: 1 }, RECT);
    expect(e).toEqual({ type: "wheel", screen: { x: 0, y: 0 }, deltaX: 16, deltaY: 48, mods: NO_MODS });
  });
});

describe("keys", () => {
  it("passes ordinary keys through verbatim", () => {
    expect(keyEvent({ ...NO_DOM_MODS, key: "w", code: "KeyW", repeat: false })).toEqual({ type: "key", key: "w", mods: NO_MODS });
    expect(keyEvent({ ...NO_DOM_MODS, key: "Enter", code: "Enter", repeat: false })).toEqual({ type: "key", key: "Enter", mods: NO_MODS });
    expect(keyEvent({ ...NO_DOM_MODS, key: " ", code: "Space", repeat: false })).toEqual({ type: "key", key: " ", mods: NO_MODS });
  });

  it("types digits while Shift is held (demo step 2)", () => {
    expect(keyEvent({ ...NO_DOM_MODS, shiftKey: true, key: "^", code: "Digit6", repeat: false })).toEqual({
      type: "key",
      key: "6",
      mods: { ...NO_MODS, shift: true },
    });
  });

  it("maps digit and decimal codes on any layout", () => {
    expect(normalizeKey("&", "Digit1")).toBe("1");
    expect(normalizeKey("4", "Numpad4")).toBe("4");
    expect(normalizeKey(">", "Period")).toBe(".");
    expect(normalizeKey(",", "NumpadDecimal")).toBe(".");
    expect(normalizeKey("z", "KeyZ")).toBe("z");
  });

  it("drops auto-repeated modifier keys but keeps other repeats", () => {
    expect(keyEvent({ ...NO_DOM_MODS, shiftKey: true, key: "Shift", code: "ShiftLeft", repeat: true })).toBeNull();
    expect(keyEvent({ ...NO_DOM_MODS, key: "Backspace", code: "Backspace", repeat: true })).toEqual({
      type: "key",
      key: "Backspace",
      mods: NO_MODS,
    });
  });

  it("recognises editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("prevents browser defaults only for keys the browser would act on", () => {
    expect(shouldPreventDefault(" ", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("Backspace", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("Enter", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("w", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("Escape", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("z", { ...NO_MODS, meta: true })).toBe(true);
    expect(shouldPreventDefault("Z", { ...NO_MODS, meta: true, shift: true })).toBe(true);
    expect(shouldPreventDefault("s", { ...NO_MODS, ctrl: true })).toBe(true);
    expect(shouldPreventDefault("c", { ...NO_MODS, meta: true })).toBe(false);
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test input`
Expected: FAIL, because `../src/adapters/input` cannot be resolved.

- [x] **Step 3: Implement the pure helpers**

`packages/web/src/adapters/input.ts`:

```ts
import type { Event as EditorEvent, Mods } from "@fm/editor";
import type { Point } from "@fm/protocol";

export type ModifierSource = { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };
type PointerSource = ModifierSource & { clientX: number; clientY: number; button: number; buttons: number };
type WheelSource = ModifierSource & { clientX: number; clientY: number; deltaX: number; deltaY: number; deltaMode: number };
type KeySource = ModifierSource & { key: string; code: string; repeat: boolean };
type Rect = { left: number; top: number };

export function toMods(e: ModifierSource): Mods {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/** DOM `button` of a press or release → editor button; back/forward buttons are ignored. */
export function pressButton(button: number): 0 | 1 | 2 | null {
  switch (button) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return null;
  }
}

/** DOM `buttons` bitmask during a move → the held button; middle wins so a middle-drag pans. */
export function heldButton(buttons: number): 0 | 1 | 2 {
  if ((buttons & 4) !== 0) return 1;
  if ((buttons & 2) !== 0) return 2;
  return 0;
}

/** CSS pixels relative to the canvas's top-left corner. World coordinates are the editor's job. */
export function canvasPoint(e: { clientX: number; clientY: number }, rect: Rect): Point {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function pointerEvent(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  e: PointerSource,
  rect: Rect,
): EditorEvent | null {
  const button = type === "pointerMove" ? heldButton(e.buttons) : pressButton(e.button);
  if (button === null) return null;
  return { type, screen: canvasPoint(e, rect), mods: toMods(e), button };
}

const LINE_PX = 16;
const PAGE_PX = 800;

export function wheelEvent(e: WheelSource, rect: Rect): EditorEvent {
  const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  return {
    type: "wheel",
    screen: canvasPoint(e, rect),
    deltaX: e.deltaX * scale,
    deltaY: e.deltaY * scale,
    mods: toMods(e),
  };
}

/**
 * Typed lengths must work while Shift is held (demo step 2) and on non-US layouts:
 * digit and decimal keys are identified by their physical code; other keys pass through verbatim.
 */
export function normalizeKey(key: string, code: string): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit !== null && digit[1] !== undefined) return digit[1];
  if (code === "Period" || code === "NumpadDecimal") return ".";
  return key;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function keyEvent(e: KeySource): EditorEvent | null {
  if (e.repeat && MODIFIER_KEYS.has(e.key)) return null;
  return { type: "key", key: normalizeKey(e.key, e.code), mods: toMods(e) };
}

/** Keys typed into panel inputs belong to the input, not to the editor. */
export function isEditableTarget(target: object | null): boolean {
  if (target === null) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  if (!("tagName" in target) || typeof target.tagName !== "string") return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Only keys the browser would otherwise act on: scrolling, navigation, activation, undo and save. */
export function shouldPreventDefault(key: string, mods: Mods): boolean {
  if (mods.meta || mods.ctrl) {
    const k = key.toLowerCase();
    return k === "z" || k === "y" || k === "s";
  }
  return key === " " || key === "Backspace" || key === "Enter";
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test input`
Expected: PASS, 16 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/input.ts packages/web/test/input.test.ts
git commit -m "web: pure DOM-to-editor input mapping (screen coords, buttons, wheel, keys)"
```

---

### Task 4.5: `attachInput` DOM wiring

**Files:** modify `packages/web/src/adapters/input.ts` by appending `attachInput` at the end of the file.

The wiring is thin glue over the helpers from Task 4.4. The Playwright smoke test (Task 4.12) and the gate's manual checklist cover it; no unit test is added because jsdom would test jsdom, not Chromium.

Behaviour:
- Pointer events on the canvas, with pointer capture from down to up, so a drag keeps its events when it leaves the canvas.
- Pressing the canvas blurs a focused panel input, so its pending edit commits (Task 4.10) before the editor sees the press.
- A middle-button press has `preventDefault`, to suppress autoscroll.
- The context menu is suppressed.
- Wheel events are non-passive and always `preventDefault`. This stops page zoom on pinch and back-swipe on a horizontal trackpad scroll.
- Key events are listened for on `window`. Editable targets are skipped; handled browser defaults are prevented.
- A `ResizeObserver` on the canvas sends `viewportResized` with the CSS size and `devicePixelRatio`. One is also sent at once on attach.

- [x] **Step 1: Append `attachInput` to `packages/web/src/adapters/input.ts`**

```ts
/** Wires DOM input on the canvas (and keys on window) to editor events. Returns a detach function. */
export function attachInput(canvas: HTMLCanvasElement, dispatch: (e: EditorEvent) => void): () => void {
  const rect = (): DOMRect => canvas.getBoundingClientRect();
  const send = (e: EditorEvent | null): void => {
    if (e !== null) dispatch(e);
  };

  const onPointerDown = (e: PointerEvent): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    send(pointerEvent("pointerDown", e, rect()));
  };
  const onPointerMove = (e: PointerEvent): void => {
    send(pointerEvent("pointerMove", e, rect()));
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    send(pointerEvent("pointerUp", e, rect()));
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    send(wheelEvent(e, rect()));
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (shouldPreventDefault(e.key, toMods(e))) e.preventDefault();
    send(keyEvent(e));
  };
  const onResize = (): void => {
    const r = rect();
    dispatch({ type: "viewportResized", size: { width: r.width, height: r.height }, devicePixelRatio: window.devicePixelRatio });
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  const observer = new ResizeObserver(onResize);
  observer.observe(canvas);
  onResize();

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    observer.disconnect();
  };
}
```

- [x] **Step 2: Verify and commit**

Run: `pnpm check`. Expected: pass; the existing input tests still pass.

```bash
git add packages/web/src/adapters/input.ts
git commit -m "web: attachInput wires pointer, wheel, key and resize events"
```

---

### Task 4.6: Renderer port and `drawPrimitive`

**Files:** create `packages/web/src/adapters/renderer.ts`, `packages/web/src/adapters/canvas2d-renderer.ts` (`DrawContext`, `widthPx` and `drawPrimitive` only) and `packages/web/test/fixtures.ts`; test `packages/web/test/canvas2d-renderer.test.ts`.

Conventions fixed here, and flagged as spec ambiguities:
- `Width { px }` is in screen pixels; `Width { m }` is multiplied by `camera.zoom`.
- `dash` values are in **screen pixels**.
- `arc.radius` is in metres. `from` and `to` are world radians, counter-clockwise from `from` to `to`. World y points up, so the renderer negates the angles and draws anticlockwise in screen space.
- `text.size` is in px. The family is `UI_FONT` at weight 400, the same string the web host measures (Task 4.2). A non-zero `rotation` is world radians counter-clockwise, drawn as `-rotation` on screen. `textBaseline` is `middle`, so `at` is the vertical centre of the text.

- [x] **Step 1: Test fixtures**

`packages/web/test/fixtures.ts`:

```ts
import type { Camera, Scene, ViewModel } from "@fm/editor";

export const cameraFixture: Camera = {
  center: { x: 0, y: 0 },
  zoom: 100,
  viewport: { width: 200, height: 100 },
  dpr: 2,
};

export function sceneFixture(): Scene {
  const names = ["grid", "zoneFills", "walls", "annotations", "overlays", "presence"] as const;
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
```

- [x] **Step 2: Write the failing test**

`packages/web/test/canvas2d-renderer.test.ts`. With `cameraFixture`, `worldToScreen` maps (0, 0) → (100, 50), (1, 0) → (200, 50), (0, 1) → (100, −50) and (1, 0.5) → (200, 0).

```ts
import { describe, expect, it } from "vitest";
import { UI_FONT, type Primitive } from "@fm/editor";
import { drawPrimitive, type DrawContext } from "../src/adapters/canvas2d-renderer";
import { cameraFixture } from "./fixtures";

const f = (n: number): string => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);

/** Records drawing calls with the style in effect at each fill or stroke. */
export class RecordingContext implements DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  readonly calls: string[] = [];
  private dash: number[] = [];

  beginPath(): void {
    this.calls.push("beginPath");
  }
  closePath(): void {
    this.calls.push("closePath");
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo ${f(x)} ${f(y)}`);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo ${f(x)} ${f(y)}`);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.calls.push(`arc ${f(x)} ${f(y)} ${f(r)} ${f(start)} ${f(end)} ${ccw ? "ccw" : "cw"}`);
  }
  fill(): void {
    this.calls.push(`fill ${String(this.fillStyle)}`);
  }
  stroke(): void {
    this.calls.push(`stroke ${String(this.strokeStyle)} w=${f(this.lineWidth)} cap=${this.lineCap} dash=[${this.dash.join(",")}]`);
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(
      `fillText "${text}" ${f(x)} ${f(y)} font=${this.font} align=${this.textAlign} baseline=${this.textBaseline} color=${String(this.fillStyle)}`,
    );
  }
  setLineDash(segments: number[]): void {
    this.dash = [...segments];
  }
  save(): void {
    this.calls.push("save");
  }
  restore(): void {
    this.calls.push("restore");
  }
  translate(x: number, y: number): void {
    this.calls.push(`translate ${f(x)} ${f(y)}`);
  }
  rotate(angle: number): void {
    this.calls.push(`rotate ${f(angle)}`);
  }
  scale(x: number, y: number): void {
    this.calls.push(`scale ${f(x)} ${f(y)}`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect ${f(x)} ${f(y)} ${f(w)} ${f(h)} ${String(this.fillStyle)}`);
  }
}

function draw(p: Primitive): string[] {
  const ctx = new RecordingContext();
  drawPrimitive(ctx, p, cameraFixture);
  return ctx.calls;
}

describe("drawPrimitive", () => {
  it("strokes a segment with a world-scaled width", () => {
    const calls = draw({ kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0.5 }, width: { m: 0.2 }, color: "#111111", cap: "butt" });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 200.00 0.00", "stroke #111111 w=20.00 cap=butt dash=[]"]);
  });

  it("strokes a dashed hairline with a screen width", () => {
    const calls = draw({
      kind: "segment",
      a: { x: 0, y: 0 },
      b: { x: 0, y: 1 },
      width: { px: 1 },
      color: "#2f6fed",
      cap: "round",
      dash: [4, 2],
    });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 100.00 -50.00", "stroke #2f6fed w=1.00 cap=round dash=[4,2]"]);
  });

  it("does not leak a dash into the next segment", () => {
    const ctx = new RecordingContext();
    drawPrimitive(ctx, { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt", dash: [4, 2] }, cameraFixture);
    drawPrimitive(ctx, { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt" }, cameraFixture);
    expect(ctx.calls.at(-1)).toBe("stroke #000000 w=1.00 cap=butt dash=[]");
  });

  it("fills a polygon and skips degenerate ones", () => {
    const calls = draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], color: "#eeeeee" });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 200.00 50.00", "lineTo 100.00 -50.00", "closePath", "fill #eeeeee"]);
    expect(draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: "#eeeeee" })).toEqual([]);
  });

  it("fills a disc with a screen radius", () => {
    const calls = draw({ kind: "disc", center: { x: 1, y: 0 }, radius: { px: 5 }, color: "#2f6fed" });
    expect(calls).toEqual(["beginPath", "arc 200.00 50.00 5.00 0.00 6.28 cw", "fill #2f6fed"]);
  });

  it("strokes a world arc counter-clockwise with flipped angles", () => {
    const calls = draw({ kind: "arc", center: { x: 0, y: 0 }, radius: 0.5, from: 0, to: Math.PI / 2, width: { px: 1 }, color: "#444444" });
    expect(calls).toEqual(["beginPath", "arc 100.00 50.00 50.00 0.00 -1.57 ccw", "stroke #444444 w=1.00 cap=butt dash=[]"]);
  });

  it("draws upright text centred on its anchor with the UI font", () => {
    const calls = draw({ kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0 });
    expect(calls).toEqual([
      "save",
      "translate 200.00 50.00",
      `fillText "Kitchen" 0.00 0.00 font=12px ${UI_FONT} align=center baseline=middle color=#333333`,
      "restore",
    ]);
  });

  it("rotates text by the negated world angle", () => {
    const calls = draw({ kind: "text", text: "3.50", at: { x: 0, y: 0 }, size: 11, color: "#333333", align: "left", rotation: Math.PI / 2 });
    expect(calls.slice(0, 3)).toEqual(["save", "translate 100.00 50.00", "rotate -1.57"]);
  });
});
```

- [x] **Step 3: Run it**

Run: `pnpm --filter @fm/web test canvas2d`
Expected: FAIL, because `../src/adapters/canvas2d-renderer` cannot be resolved.

- [x] **Step 4: Implement the port and `drawPrimitive`**

`packages/web/src/adapters/renderer.ts`:

```ts
import type { Camera, Scene } from "@fm/editor";

/** Renderer port (spec §6): draws a platform-neutral Scene with a camera. */
export interface Renderer {
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}
```

`packages/web/src/adapters/canvas2d-renderer.ts`:

```ts
import { UI_FONT, worldToScreen, type Camera, type Primitive, type Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";

/** The subset of CanvasRenderingContext2D the renderer uses; tests pass a recording fake. */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Screen-constant hairlines ({ px }) versus world-scaled widths ({ m }). */
export function widthPx(width: Width, camera: Camera): number {
  return "px" in width ? width.px : width.m * camera.zoom;
}

/** Draws one primitive in CSS pixels. World y points up: angles are negated on screen. */
export function drawPrimitive(ctx: DrawContext, p: Primitive, camera: Camera): void {
  switch (p.kind) {
    case "segment": {
      const a = worldToScreen(camera, p.a);
      const b = worldToScreen(camera, p.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = widthPx(p.width, camera);
      ctx.lineCap = p.cap;
      ctx.setLineDash(p.dash ?? []);
      ctx.stroke();
      return;
    }
    case "polygon": {
      const [first, ...rest] = p.points.map((q) => worldToScreen(camera, q));
      if (first === undefined || rest.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const q of rest) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      return;
    }
    case "arc": {
      const c = worldToScreen(camera, p.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.radius * camera.zoom, -p.from, -p.to, true);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = widthPx(p.width, camera);
      ctx.lineCap = "butt";
      ctx.setLineDash([]);
      ctx.stroke();
      return;
    }
    case "disc": {
      const c = worldToScreen(camera, p.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, widthPx(p.radius, camera), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      return;
    }
    case "text": {
      const at = worldToScreen(camera, p.at);
      ctx.save();
      ctx.translate(at.x, at.y);
      if (p.rotation !== 0) ctx.rotate(-p.rotation);
      ctx.font = `${p.size}px ${UI_FONT}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
      return;
    }
    default:
      assertNever(p);
  }
}
```

Note: `ctx.font` is written as `12px <family>`, while `fontString` in the web host writes `400 12px <family>`. The two are the same CSS font (weight 400 is the default), so measured and drawn widths match.

- [x] **Step 5: Run it**

Run: `pnpm --filter @fm/web test canvas2d`
Expected: PASS, 8 tests.

- [x] **Step 6: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/renderer.ts packages/web/src/adapters/canvas2d-renderer.ts packages/web/test/fixtures.ts packages/web/test/canvas2d-renderer.test.ts
git commit -m "web: Renderer port and Canvas2D primitive drawing"
```

---

### Task 4.7: `drawScene`, DPR sizing and the frame-coalescing renderer

**Files:** modify `packages/web/src/adapters/canvas2d-renderer.ts` (add the functions below at the end of the file, and extend the import line); modify `packages/web/test/canvas2d-renderer.test.ts` (add a `describe` block).

A frame fills the background and draws the layers in order. The canvas backing store is `round(CSS size × dpr)`, and the context is scaled by `dpr`, so drawing code works in CSS pixels. `render` stores the latest scene and draws once per animation frame, so bursts of pointer events cost one draw.

- [x] **Step 1: Write the failing tests**

In `packages/web/test/canvas2d-renderer.test.ts`, change the imports at the top to:

```ts
import { describe, expect, it } from "vitest";
import { COLORS, UI_FONT, type Primitive, type Scene } from "@fm/editor";
import { backingSize, drawPrimitive, drawScene, type DrawContext } from "../src/adapters/canvas2d-renderer";
import { cameraFixture, sceneFixture } from "./fixtures";
```

and append at the end of the file:

```ts
function withPrimitives(scene: Scene, byLayer: Partial<Record<string, Primitive[]>>): Scene {
  return { layers: scene.layers.map((layer) => ({ ...layer, primitives: byLayer[layer.name] ?? [] })) };
}

describe("drawScene", () => {
  const gridLine: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#dddddd", cap: "butt" };
  const wall: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], color: "#222222" };
  const cursor: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 4 }, color: "#e67e22" };

  it("scales by dpr, fills the background, then draws layers in order", () => {
    const ctx = new RecordingContext();
    // Layers are listed out of their natural order to show that scene order, not input order, is what matters.
    drawScene(ctx, withPrimitives(sceneFixture(), { presence: [cursor], walls: [wall], grid: [gridLine] }), cameraFixture);
    expect(ctx.calls.slice(0, 3)).toEqual(["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`]);
    const gridAt = ctx.calls.indexOf("stroke #dddddd w=1.00 cap=butt dash=[]");
    const wallAt = ctx.calls.indexOf("fill #222222");
    const cursorAt = ctx.calls.indexOf("fill #e67e22");
    expect(gridAt).toBeGreaterThan(2);
    expect(wallAt).toBeGreaterThan(gridAt);
    expect(cursorAt).toBeGreaterThan(wallAt);
    expect(ctx.calls.at(-1)).toBe("restore");
  });

  it("draws only the background for an empty scene", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, sceneFixture(), cameraFixture);
    expect(ctx.calls).toEqual(["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`, "restore"]);
  });
});

describe("backingSize", () => {
  it("multiplies the CSS size by the device pixel ratio", () => {
    expect(backingSize(cameraFixture)).toEqual({ width: 400, height: 200 });
  });

  it("rounds and never returns zero", () => {
    expect(backingSize({ ...cameraFixture, viewport: { width: 201, height: 0 }, dpr: 1.5 })).toEqual({ width: 302, height: 1 });
  });
});
```

`UI_FONT` stays imported for the text tests above.

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test canvas2d`
Expected: FAIL, because `drawScene` and `backingSize` are not exported.

- [x] **Step 3: Implement**

In `packages/web/src/adapters/canvas2d-renderer.ts`, change the imports to:

```ts
import { COLORS, UI_FONT, worldToScreen, type Camera, type Primitive, type Scene, type Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { Renderer } from "./renderer";
```

and append:

```ts
/** One frame in CSS pixels: dpr scale, background, then layers in scene order. */
export function drawScene(ctx: DrawContext, scene: Scene, camera: Camera): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, camera.viewport.width, camera.viewport.height);
  for (const layer of scene.layers) {
    for (const p of layer.primitives) drawPrimitive(ctx, p, camera);
  }
  ctx.restore();
}

/** Backing-store size for crisp output on high-DPI screens. */
export function backingSize(camera: Camera): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(camera.viewport.width * camera.dpr)),
    height: Math.max(1, Math.round(camera.viewport.height * camera.dpr)),
  };
}

/** Canvas2D renderer: keeps the latest scene and draws it once per animation frame. */
export function createCanvas2DRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx === null) throw new Error("Canvas 2D context unavailable");
  let pending: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;

  const draw = (): void => {
    frame = null;
    if (pending === null) return;
    const { scene, camera } = pending;
    pending = null;
    const size = backingSize(camera);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    drawScene(ctx, scene, camera);
  };

  return {
    render(scene, camera) {
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    },
  };
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test canvas2d`
Expected: PASS, 12 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/canvas2d-renderer.ts packages/web/test/canvas2d-renderer.test.ts
git commit -m "web: Canvas2D scene drawing with DPR sizing and frame coalescing"
```

---

### Task 4.8: Effect runner

**Files:** create `packages/web/src/adapters/effect-runner.ts`; test `packages/web/test/effect-runner.test.ts`.

- `server` is a **sink function for server effects** (`workspace`, `submit`, `presence`), not a `WsServer`: `ClientMessage` does not exist until phase 6; phase 7 builds the sink from its `WsServer` (README contract, revised while planning).
- The `render` effect carries the camera (`{ scene, view, camera }`, spec §5.2, revised while planning), so the shell never reads editor state to draw.

- [x] **Step 1: Write the failing test**

`packages/web/test/effect-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Camera, Effect, Scene, ViewModel } from "@fm/editor";
import { createEffectRunner, type ServerEffect } from "../src/adapters/effect-runner";
import type { Renderer } from "../src/adapters/renderer";
import type { Timers } from "../src/adapters/timers";
import { cameraFixture, sceneFixture, viewFixture } from "./fixtures";

function harness(withServer: boolean) {
  const log: string[] = [];
  const rendered: { scene: Scene; camera: Camera }[] = [];
  const views: ViewModel[] = [];
  const serverEffects: ServerEffect[] = [];
  const renderer: Renderer = {
    render: (scene, camera) => {
      rendered.push({ scene, camera });
      log.push("render");
    },
    dispose: () => {},
  };
  const timers: Timers = {
    start: (id, ms) => {
      log.push(`start ${id} ${ms}`);
    },
    cancel: (id) => {
      log.push(`cancel ${id}`);
    },
    dispose: () => {},
  };
  const run = createEffectRunner({
    renderer,
    timers,
    server: withServer
      ? (effect) => {
          serverEffects.push(effect);
          log.push(`server ${effect.type}`);
        }
      : null,
    onView: (view) => {
      views.push(view);
      log.push("view");
    },
  });
  return { run, log, rendered, views, serverEffects };
}

const scene = sceneFixture();
const view = viewFixture({ activeTool: "wall" });
const serverEffects: Effect[] = [
  { type: "workspace", op: { type: "list", requestId: "r1" } },
  { type: "submit", projectId: "p1", generation: "g1", changeset: { id: "c1", patch: { puts: [], deletes: [] }, expect: [] } },
  { type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [] },
];

describe("effect runner", () => {
  it("renders the scene with the effect's camera and publishes the view", () => {
    const h = harness(false);
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    expect(h.rendered).toEqual([{ scene, camera: cameraFixture }]);
    expect(h.views).toEqual([view]);
    expect(h.log).toEqual(["render", "view"]);
  });

  it("routes timer effects to the timers adapter", () => {
    const h = harness(false);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
    ]);
    expect(h.log).toEqual(["start toast 3000", "cancel toast"]);
  });

  it("hands workspace, submit and presence effects to the server sink in order", () => {
    const h = harness(true);
    h.run(serverEffects);
    expect(h.serverEffects).toEqual(serverEffects);
    expect(h.log).toEqual(["server workspace", "server submit", "server presence"]);
  });

  it("ignores server effects when there is no server (local mode)", () => {
    const h = harness(false);
    h.run(serverEffects);
    expect(h.log).toEqual([]);
  });

  it("ignores saveSnapshot until local files exist (X1)", () => {
    const h = harness(true);
    h.run([{ type: "saveSnapshot", projectId: "p1", writeId: "w1", content: "{}" }]);
    expect(h.log).toEqual([]);
  });

  it("keeps effect order across kinds", () => {
    const h = harness(true);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "render", scene, view, camera: cameraFixture },
    ]);
    expect(h.log).toEqual(["start toast 3000", "server workspace", "render", "view"]);
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test effect-runner`
Expected: FAIL, because `../src/adapters/effect-runner` cannot be resolved.

- [x] **Step 3: Implement**

`packages/web/src/adapters/effect-runner.ts`:

```ts
import type { Effect, ViewModel } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { Renderer } from "./renderer";
import type { Timers } from "./timers";

export type ServerEffect = Extract<Effect, { type: "workspace" | "submit" | "presence" }>;
/** Phase 7 builds this from the WebSocket adapter; local mode passes null. */
export type ServerEffectSink = (effect: ServerEffect) => void;

export type EffectRunnerDeps = {
  renderer: Renderer;
  timers: Timers;
  server: ServerEffectSink | null;
  onView(view: ViewModel): void;
};

/** Performs effects in order (spec §5.2); results come back later as events. */
export function createEffectRunner(deps: EffectRunnerDeps): (effects: Effect[]) => void {
  return (effects) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "render":
          deps.renderer.render(effect.scene, effect.camera);
          deps.onView(effect.view);
          break;
        case "startTimer":
          deps.timers.start(effect.timerId, effect.ms);
          break;
        case "cancelTimer":
          deps.timers.cancel(effect.timerId);
          break;
        case "workspace":
        case "submit":
        case "presence":
          if (deps.server !== null) deps.server(effect);
          break;
        case "saveSnapshot":
          // Local-folder workspace is follow-up X1 (spec §7.8); the initial build never emits it.
          break;
        default:
          assertNever(effect);
      }
    }
  };
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test effect-runner`
Expected: PASS, 6 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/adapters/effect-runner.ts packages/web/test/effect-runner.test.ts
git commit -m "web: effect runner routes render, timer and server effects"
```

---

### Task 4.9: Editor store

**Files:** create `packages/web/src/store.ts`; test `packages/web/test/store.test.ts`.

The store is the only place that holds `EditorState` in the web app. `dispatch` runs `update` and hands the effects to the runner. Events dispatched while effects run are queued and handled after the current batch, in order, never recursively. React reads the view through `useSyncExternalStore(subscribe, getView)`. `getView` returns the same object until a new render effect publishes one. The tests use the real editor from phase 3.

- [x] **Step 1: Write the failing test**

`packages/web/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialState, type EditorState, type Host } from "@fm/editor";
import { createEditorStore } from "../src/store";

function testHost(): Host {
  let n = 0;
  return {
    textMetrics: (text, font) => ({ width: text.length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
    now: () => 0,
    newId: () => `id${++n}`,
  };
}

function localState(host: Host): EditorState {
  return initialState({ mode: "local", me: { clientId: "c1", name: "Alice" }, viewport: { width: 800, height: 600 }, dpr: 1 }, host);
}

function storeWithViewPublishing() {
  const host = testHost();
  const store = createEditorStore({ initial: localState(host), host });
  store.setRunner((effects) => {
    for (const e of effects) if (e.type === "render") store.publishView(e.view);
  });
  return store;
}

describe("editor store", () => {
  it("exposes a view before the first render", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    expect(store.getView().activeTool).toBe("select");
    expect(store.getView()).toBe(store.getView());
  });

  it("runs update and hands every effect to the runner", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    const types: string[] = [];
    store.setRunner((effects) => {
      for (const e of effects) types.push(e.type);
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(store.getState().tool.name).toBe("wall");
    expect(types.at(-1)).toBe("render");
  });

  it("publishes views to subscribers until they unsubscribe", () => {
    const store = storeWithViewPublishing();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(store.getView().activeTool).toBe("wall");
    expect(notified).toBe(1);
    unsubscribe();
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "zone" } });
    expect(store.getView().activeTool).toBe("zone");
    expect(notified).toBe(1);
  });

  it("queues events dispatched by effects instead of recursing", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    const seen: string[] = [];
    let depth = 0;
    let maxDepth = 0;
    let first = true;
    store.setRunner(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      seen.push(`batch ${store.getState().tool.name}`);
      if (first) {
        first = false;
        store.dispatch({ type: "ui", action: { type: "pickTool", tool: "zone" } });
        seen.push("dispatched");
      }
      depth -= 1;
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(seen).toEqual(["batch wall", "dispatched", "batch zone"]);
    expect(maxDepth).toBe(1);
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test store`
Expected: FAIL, because `../src/store` cannot be resolved.

- [x] **Step 3: Implement**

`packages/web/src/store.ts`:

```ts
import {
  buildViewModel,
  update,
  type EditorState,
  type Effect,
  type Event as EditorEvent,
  type Host,
  type ViewModel,
} from "@fm/editor";

export type EditorStore = {
  dispatch(e: EditorEvent): void;
  getView(): ViewModel;
  getState(): EditorState;
  publishView(view: ViewModel): void;
  subscribe(fn: () => void): () => void;
  setRunner(run: (effects: Effect[]) => void): void;
};

/** Holds the editor state; the shell's only mutable copy of it. */
export function createEditorStore(opts: { initial: EditorState; host: Host }): EditorStore {
  let state = opts.initial;
  let view = buildViewModel(state, opts.host);
  let run: (effects: Effect[]) => void = () => {};
  const listeners = new Set<() => void>();
  const queue: EditorEvent[] = [];
  let draining = false;

  function dispatch(e: EditorEvent): void {
    queue.push(e);
    if (draining) return; // dispatched by an effect: the loop below handles it after the current batch
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const result = update(state, next, opts.host);
        state = result.state;
        run(result.effects);
      }
    } catch (error) {
      queue.length = 0; // fail fast: never replay events queued behind a failed update
      throw error;
    } finally {
      draining = false;
    }
  }

  return {
    dispatch,
    getView: () => view,
    getState: () => state,
    publishView(next) {
      view = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setRunner(next) {
      run = next;
    },
  };
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test store`
Expected: PASS, 4 tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/store.ts packages/web/test/store.test.ts
git commit -m "web: editor store with queued dispatch and view subscription"
```

---

### Task 4.10: React panels

**Files:** create `packages/web/src/panels/types.ts`, `Toolbar.tsx`, `CommandBar.tsx`, `PropertiesPanel.tsx`, `StatusBar.tsx` and `Toast.tsx`; test `packages/web/test/panels.test.tsx`.

The panels render only the ViewModel and send only `ui` events (spec §5.2). Rules:
- Toolbar buttons never take focus (`onMouseDown` with `preventDefault`). A focused button would also react to `Space` and `Enter`, which the editor uses to confirm.
- An editable property field keeps a local draft. It sends `setField` on blur when the draft differs; `Enter` blurs, and `Escape` restores the value without sending. Pressing the canvas blurs the field (Task 4.5), so a pending rename commits before the press.
- Editable fields are disabled when `view.project.canEdit` is false (a shared document waiting for the server, phase 7).

The panels are tested with `renderToStaticMarkup` in Node; interaction is covered by e2e (here and in phase 5).

- [x] **Step 1: Write the failing test**

`packages/web/test/panels.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommandBar } from "../src/panels/CommandBar";
import { PropertiesPanel } from "../src/panels/PropertiesPanel";
import { StatusBar } from "../src/panels/StatusBar";
import { Toast } from "../src/panels/Toast";
import { Toolbar } from "../src/panels/Toolbar";
import { viewFixture } from "./fixtures";

const send = (): void => {};

function inputTag(html: string, fieldId: string): string {
  const match = new RegExp(`<input[^>]*data-field-id="${fieldId}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`no input for ${fieldId} in ${html}`);
  return match[0];
}

describe("Toolbar", () => {
  it("marks the active tool", () => {
    const html = renderToStaticMarkup(<Toolbar view={viewFixture({ activeTool: "wall" })} send={send} />);
    expect(html).toContain('data-tool="wall" aria-pressed="true"');
    expect(html).toContain('data-tool="select" aria-pressed="false"');
    expect(html).toContain('data-tool="zone" aria-pressed="false"');
  });

  it("disables undo and redo from the ViewModel", () => {
    const html = renderToStaticMarkup(<Toolbar view={viewFixture({ canUndo: false, canRedo: true })} send={send} />);
    expect(html).toMatch(/<button[^>]*data-action="undo"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*data-action="redo"[^>]*disabled=""/);
  });
});

describe("CommandBar", () => {
  it("shows the prompt, the typed value and its unit", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "Next point or length", value: "3.2", unit: "m" } })} />);
    expect(html).toContain("Next point or length");
    expect(html).toContain('data-testid="command-value">3.2<');
    expect(html).toContain(">m<");
  });

  it("hides the unit while nothing is typed", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "First point", value: "", unit: "m" } })} />);
    expect(html).not.toContain(">m<");
  });
});

describe("PropertiesPanel", () => {
  it("says when nothing is selected", () => {
    expect(renderToStaticMarkup(<PropertiesPanel view={viewFixture()} send={send} />)).toContain("Nothing selected");
  });

  it("renders read-only wall fields with their field IDs", () => {
    const view = viewFixture({
      properties: {
        kind: "wall",
        fields: [
          { id: "length", label: "Length", value: "6.00", unit: "m", readOnly: true },
          { id: "thickness", label: "Thickness", value: "0.20", unit: "m", readOnly: true },
        ],
      },
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={send} />);
    expect(html).toContain(">Wall<");
    const length = inputTag(html, "length");
    expect(length).toContain('value="6.00"');
    expect(length).toContain('readonly=""');
    expect(inputTag(html, "thickness")).toContain('value="0.20"');
  });

  it("renders an editable zone name, disabled when editing is blocked", () => {
    const fields = [
      { id: "name", label: "Name", value: "Kitchen", unit: null, readOnly: false },
      { id: "area", label: "Area", value: "10.64 m²", unit: null, readOnly: true },
    ];
    const editable = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "zone", fields } })} send={send} />);
    const name = inputTag(editable, "name");
    expect(name).toContain('value="Kitchen"');
    expect(name).not.toContain("readonly");
    expect(name).not.toContain("disabled");

    const blocked = renderToStaticMarkup(
      <PropertiesPanel
        view={viewFixture({
          properties: { kind: "zone", fields },
          project: { name: "Apartment", status: "waiting for server", dirty: false, canEdit: false },
        })}
        send={send}
      />,
    );
    expect(inputTag(blocked, "name")).toContain('disabled=""');
  });
});

describe("StatusBar", () => {
  it("shows the project, its status and collaborators", () => {
    const html = renderToStaticMarkup(
      <StatusBar
        view={viewFixture({
          project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
          presence: [{ clientId: "b", name: "Bob", color: "#e67e22", at: null }],
        })}
      />,
    );
    expect(html).toContain('data-testid="project-name">Apartment<');
    expect(html).toContain('data-testid="project-status" data-status="saved">saved<');
    expect(html).toMatch(/data-testid="collaborators"[^>]*>.*Bob/);
  });

  it("renders an empty collaborators list and no status without a project", () => {
    const html = renderToStaticMarkup(<StatusBar view={viewFixture({ project: null })} />);
    expect(html).toContain("No drawing open");
    expect(html).not.toContain("project-status");
    expect(html).toContain('data-testid="collaborators"');
  });
});

describe("Toast", () => {
  it("renders nothing without a toast", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture()} />)).toBe("");
  });

  it("renders the toast text as a status message", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture({ toast: "Wall too short" })} />)).toBe(
      '<div class="toast" role="status">Wall too short</div>',
    );
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test panels`
Expected: FAIL, because `../src/panels/CommandBar` cannot be resolved.

- [x] **Step 3: Implement the panels**

`packages/web/src/panels/types.ts`:

```ts
import type { UiAction, ViewModel } from "@fm/editor";

export type PanelProps = { view: ViewModel; send(action: UiAction): void };
export type ViewProps = { view: ViewModel };
```

`packages/web/src/panels/Toolbar.tsx`:

```tsx
import type { MouseEvent } from "react";
import type { ToolName } from "@fm/editor";
import type { PanelProps } from "./types";

const TOOLS: readonly { tool: ToolName; label: string; shortcut: string }[] = [
  { tool: "select", label: "Select", shortcut: "V" },
  { tool: "wall", label: "Wall", shortcut: "W" },
  { tool: "zone", label: "Zone", shortcut: "Z" },
];

/** A focused button would also react to Space and Enter, which the editor uses to confirm. */
const keepFocus = (e: MouseEvent): void => {
  e.preventDefault();
};

export function Toolbar({ view, send }: PanelProps) {
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          data-tool={t.tool}
          aria-pressed={view.activeTool === t.tool}
          title={`${t.label} (${t.shortcut})`}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "pickTool", tool: t.tool })}
        >
          {t.label} <kbd>{t.shortcut}</kbd>
        </button>
      ))}
      <span className="toolbar-sep" />
      <button type="button" data-action="undo" disabled={!view.canUndo} title="Undo (⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "undo" })}>
        Undo
      </button>
      <button type="button" data-action="redo" disabled={!view.canRedo} title="Redo (⇧⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "redo" })}>
        Redo
      </button>
    </nav>
  );
}
```

`packages/web/src/panels/CommandBar.tsx`:

```tsx
import type { ViewProps } from "./types";

export function CommandBar({ view }: ViewProps) {
  const { prompt, value, unit } = view.commandBar;
  return (
    <div className="command-bar" data-testid="command-bar">
      <span className="command-prompt">{prompt}</span>
      <span className="command-value" data-testid="command-value">{value}</span>
      {unit !== null && value !== "" ? <span className="command-unit">{unit}</span> : null}
    </div>
  );
}
```

`packages/web/src/panels/PropertiesPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { Field, UiAction } from "@fm/editor";
import type { PanelProps } from "./types";

const TITLES = { wall: "Wall", joint: "Joint", zone: "Zone" } as const;

export function PropertiesPanel({ view, send }: PanelProps) {
  const props = view.properties;
  if (props.kind === "none") {
    return (
      <aside className="properties" data-testid="properties">
        <p className="muted">Nothing selected</p>
      </aside>
    );
  }
  const canEdit = view.project?.canEdit ?? false;
  return (
    <aside className="properties" data-testid="properties">
      <h2>{TITLES[props.kind]}</h2>
      {props.fields.map((field) => (
        <label key={`${props.kind}:${field.id}`} className="field">
          <span className="field-label">{field.label}</span>
          {field.readOnly ? (
            <input readOnly value={field.value} data-field-id={field.id} />
          ) : (
            <EditableField field={field} disabled={!canEdit} send={send} />
          )}
          {field.unit !== null ? <span className="field-unit">{field.unit}</span> : null}
        </label>
      ))}
    </aside>
  );
}

/** Local draft; commits on blur (Enter blurs), Escape restores without sending. */
function EditableField({ field, disabled, send }: { field: Field; disabled: boolean; send(action: UiAction): void }) {
  const [draft, setDraft] = useState(field.value);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(field.value);
  }, [field.value]);

  return (
    <input
      value={draft}
      disabled={disabled}
      data-field-id={field.id}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft !== field.value) send({ type: "setField", fieldId: field.id, value: draft });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(field.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
```

`packages/web/src/panels/StatusBar.tsx`:

```tsx
import type { ViewProps } from "./types";

export function StatusBar({ view }: ViewProps) {
  const project = view.project;
  return (
    <footer className="status-bar">
      <span className="project-name" data-testid="project-name">{project?.name ?? "No drawing open"}</span>
      {project !== null ? (
        <span className="project-status" data-testid="project-status" data-status={project.status}>{project.status}</span>
      ) : null}
      <ul className="collaborators" data-testid="collaborators" aria-label="Collaborators">
        {view.presence.map((p) => (
          <li key={p.clientId}>
            <span className="swatch" style={{ background: p.color }} />
            {p.name}
          </li>
        ))}
      </ul>
    </footer>
  );
}
```

`packages/web/src/panels/Toast.tsx`:

```tsx
import type { ViewProps } from "./types";

export function Toast({ view }: ViewProps) {
  if (view.toast === null) return null;
  return (
    <div className="toast" role="status">
      {view.toast}
    </div>
  );
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test panels`
Expected: PASS, 11 tests. If an attribute-order assertion fails, React printed the attributes in a different order; check the JSX prop order against the test before changing either.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/panels packages/web/test/panels.test.tsx
git commit -m "web: React panels render the ViewModel and send ui events"
```

---

### Task 4.11: Identity, layout and composition root

**Files:** create `packages/web/src/identity.ts`, `packages/web/src/app.tsx` and `packages/web/src/styles.css`; replace `packages/web/src/main.tsx`; test `packages/web/test/identity.test.ts`.

`main.tsx` is the only place that knows every adapter. `App` renders the panels and hands the canvas element to an injected `mountCanvas`, which wires the renderer, the effect runner and input, and returns a cleanup function.

- [x] **Step 1: Write the failing identity test**

`packages/web/test/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { displayNameFrom } from "../src/identity";

describe("displayNameFrom", () => {
  it("reads ?name=", () => {
    expect(displayNameFrom("?name=Alice")).toBe("Alice");
  });

  it("trims and defaults to Guest", () => {
    expect(displayNameFrom("?name=%20Bob%20")).toBe("Bob");
    expect(displayNameFrom("?name=%20%20")).toBe("Guest");
    expect(displayNameFrom("")).toBe("Guest");
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/web test identity`
Expected: FAIL, because `../src/identity` cannot be resolved.

- [x] **Step 3: Implement `identity.ts`**

`packages/web/src/identity.ts`:

```ts
/** Display name from the `?name=` URL parameter (spec §7.2.1); "Guest" when absent or blank. */
export function displayNameFrom(search: string): string {
  const name = new URLSearchParams(search).get("name")?.trim() ?? "";
  return name === "" ? "Guest" : name;
}

/** Tab-scoped client ID: survives reloads of this tab, differs between tabs. */
export function tabClientId(storage: Storage, newId: () => string): string {
  const key = "fm.clientId";
  const existing = storage.getItem(key);
  if (existing !== null) return existing;
  const id = newId();
  storage.setItem(key, id);
  return id;
}
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/web test identity`
Expected: PASS, 2 tests.

- [x] **Step 5: Layout component**

`packages/web/src/app.tsx`:

```tsx
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";
import { CommandBar } from "./panels/CommandBar";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { StatusBar } from "./panels/StatusBar";
import { Toast } from "./panels/Toast";
import { Toolbar } from "./panels/Toolbar";
import type { EditorStore } from "./store";

export type AppProps = { store: EditorStore; mountCanvas(canvas: HTMLCanvasElement): () => void };

export function App({ store, mountCanvas }: AppProps) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    return mountCanvas(canvas);
  }, [mountCanvas]);

  const send = useCallback((action: UiAction) => store.dispatch({ type: "ui", action }), [store]);

  return (
    <div className="app">
      <Toolbar view={view} send={send} />
      <div className="workspace">
        <div className="canvas-host">
          <canvas ref={canvasRef} data-testid="canvas" style={{ cursor: view.cursor }} />
        </div>
        <PropertiesPanel view={view} send={send} />
      </div>
      <CommandBar view={view} />
      <StatusBar view={view} />
      <Toast view={view} />
    </div>
  );
}
```

- [x] **Step 6: Styles**

`packages/web/src/styles.css`:

```css
:root {
  --bg: #f4f3ef;
  --panel: #ffffff;
  --border: #e3e1db;
  --text: #1f1f1f;
  --muted: #7a776f;
  --accent: #2f6fed;
  --accent-text: #ffffff;
  --danger: #e5484d;
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  overscroll-behavior: none;
}

.app {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  height: 100%;
  user-select: none;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.toolbar button[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.toolbar button:disabled {
  color: var(--muted);
  cursor: default;
}

.toolbar kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.7;
}

.toolbar-sep {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--border);
}

.workspace {
  display: grid;
  grid-template-columns: 1fr 260px;
  min-height: 0;
}

.canvas-host {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.canvas-host canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.properties {
  padding: 12px;
  overflow: auto;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.properties h2 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
}

.field {
  display: grid;
  grid-template-columns: 80px 1fr auto;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.field-label,
.field-unit,
.muted {
  color: var(--muted);
}

.field input {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  user-select: text;
}

.field input[readonly] {
  background: var(--bg);
  border-color: transparent;
}

.command-bar {
  display: flex;
  gap: 8px;
  padding: 6px 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.command-prompt {
  color: var(--muted);
}

.command-value {
  min-width: 2ch;
  font-weight: 600;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
}

.project-name {
  color: var(--text);
  font-weight: 600;
}

.collaborators {
  display: flex;
  gap: 10px;
  margin: 0 0 0 auto;
  padding: 0;
  list-style: none;
}

.collaborators li {
  display: flex;
  align-items: center;
  gap: 4px;
}

.swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 72px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 6px;
  background: var(--text);
  color: var(--panel);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  pointer-events: none;
}
```

- [x] **Step 7: Composition root**

Replace `packages/web/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { initialState } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { createEffectRunner } from "./adapters/effect-runner";
import { createTimers } from "./adapters/timers";
import { createWebHost } from "./adapters/web-host";
import { App } from "./app";
import { displayNameFrom, tabClientId } from "./identity";
import { createEditorStore } from "./store";
import "./styles.css";

// Local mode (spec §10 step 4): one unsaved LocalDocument, no server, no project list.
const host = createWebHost();
const initial = initialState(
  {
    mode: "local",
    me: { clientId: tabClientId(sessionStorage, () => crypto.randomUUID()), name: displayNameFrom(location.search) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
  },
  host,
);
const store = createEditorStore({ initial, host });
const timers = createTimers(store.dispatch);

function mountCanvas(canvas: HTMLCanvasElement): () => void {
  const renderer = createCanvas2DRenderer(canvas);
  store.setRunner(
    createEffectRunner({
      renderer,
      timers,
      server: null,
      onView: store.publishView,
    }),
  );
  const detach = attachInput(canvas, store.dispatch); // sends viewportResized at once → first frame
  return () => {
    detach();
    store.setRunner(() => {});
    renderer.dispose();
  };
}

// Unsaved work is lost on close; the only guard in the initial build (spec §7.0).
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
createRoot(root).render(<App store={store} mountCanvas={mountCanvas} />);
```

- [x] **Step 8: Check the app by hand**

Run `pnpm dev` and open http://localhost:5173/?name=Alice. Check each item and log anything that fails in the sprint log:
- The grid is visible and crisp.
- The status bar shows "Untitled" and "not saved".
- `W` presses the Wall button.
- Draw the demo room from spec §1.4 step 2: click (0, 0), then, holding `Shift`, move right, type `6` and press `Enter`, and so on, then click the first joint. Walls appear with mitered corners, and the command bar shows the typed value while typing.
- `V`, then clicking a wall shows its length in properties.
- Two-finger scroll pans; pinch zooms at the cursor; middle-drag pans; `Space` never scrolls the page.
- Closing the tab after drawing asks for confirmation. After a reload with nothing drawn, it does not.

- [x] **Step 9: Verify and commit**

Run: `pnpm check`. Expected: pass.

```bash
git add packages/web/src/identity.ts packages/web/src/app.tsx packages/web/src/styles.css packages/web/src/main.tsx packages/web/test/identity.test.ts
git commit -m "web: layout, styles and local-mode composition root"
```

---

### Task 4.12: Playwright smoke test

**Files:** create `packages/web/playwright.config.ts` and `packages/web/e2e/smoke.spec.ts`.

The canvas cannot be read from the DOM, so the test asserts on the properties panel and the toolbar (README decision P14). World-to-screen positions mirror the editor's initial camera: centre (3, 2), `DEFAULT_ZOOM` 80 px/m (README contracts). If the defaults change, update `CENTER` and `ZOOM` in the test.

- [x] **Step 1: Install Playwright**

```bash
pnpm --filter @fm/web add -D @playwright/test
pnpm --filter @fm/web exec playwright install chromium
```

- [x] **Step 2: Config**

`packages/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [x] **Step 3: Write the smoke test**

`packages/web/e2e/smoke.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";

// Mirrors the editor's initial camera (README contracts): centre (3, 2), 80 px per metre, world y up.
const CENTER = { x: 3, y: 2 };
const ZOOM = 80;

type WorldPoint = { x: number; y: number };

async function toScreen(canvas: Locator, p: WorldPoint): Promise<WorldPoint> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  return {
    x: box.x + box.width / 2 + (p.x - CENTER.x) * ZOOM,
    y: box.y + box.height / 2 - (p.y - CENTER.y) * ZOOM,
  };
}

async function moveTo(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  const s = await toScreen(canvas, p);
  await page.mouse.move(s.x, s.y, { steps: 4 });
}

async function clickAt(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  await moveTo(page, canvas, p);
  await page.mouse.down();
  await page.mouse.up();
}

async function typeLength(page: Page, value: string): Promise<void> {
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

test("draws the demo room with typed lengths and shows a wall's length", async ({ page }) => {
  // `server=off` keeps local mode even when Playwright reuses a dev server started with VITE_SERVER_URL
  // (phase 7 reads it; until then it is ignored). (revised at review: local-mode specs must not depend on the env)
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("project-status")).toHaveText("not saved");

  // Demo step 2 (spec §1.4): W, Shift held, typed lengths along the cursor direction, click the first joint.
  await page.keyboard.press("w");
  await expect(page.locator('[data-tool="wall"]')).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");
  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await moveTo(page, canvas, { x: 3, y: 4 });
  await typeLength(page, "6");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.up("Shift");

  // Select the bottom wall and read its length from the properties panel.
  await page.keyboard.press("v");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, canvas, { x: 3, y: 0 });
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("6.00");
});
```

- [x] **Step 4: Run it**

Run: `pnpm e2e`
Expected: PASS, 1 test (Chromium). Common failures:
- A length of `5.xx` or a missing wall means the typed digits did not reach the editor with Shift held; check `normalizeKey`, Task 4.4.
- The length field missing means the click missed the wall; check that the camera defaults match `CENTER` and `ZOOM`.

Record every failure and its fix in the sprint log.

- [x] **Step 5: Verify and commit**

Run: `pnpm check`. Expected: pass; e2e is not part of `check`.

```bash
git add packages/web/playwright.config.ts packages/web/e2e/smoke.spec.ts packages/web/package.json pnpm-lock.yaml
git commit -m "web: Playwright smoke test draws the demo room"
```

---

## Completion criteria

- [x] `pnpm check` passes with `@fm/web` included: both typecheck configs, lint, dependency-cruiser and all web unit tests (59 across 9 files).
- [x] `pnpm e2e` passes in Chromium: the demo room drawn by typed lengths with `Shift` held, a wall selected, length `6.00` in properties (spec §9 web row, first half).
- [x] In `pnpm dev`, demo steps 2, 3 and 6 work by hand on an unsaved local document: the typed room, the divider joining two wall midpoints with T-junctions, and an invalid drag drawn red and reverted with a toast. Zones and the helper dimension (steps 4–5) are phase 5. (Checked by the controller with a Playwright script driving real mouse and keyboard at DPR 2, not by a person; Gate 4 lists what still needs the user's hands.)
- [x] Undo/redo work by keyboard (`Cmd+Z`, `Cmd+Shift+Z`) and through the toolbar buttons, and the buttons' disabled state follows the ViewModel.
- [x] Pan (middle-drag, two-finger scroll) and zoom (`Ctrl`/pinch + wheel at the cursor) work. `Space` never scrolls or pans. `Backspace` never navigates. `Cmd+Z` never triggers browser undo. `Cmd+S` never opens the save dialog. (Seen: wheel pan, `Ctrl`+wheel zoom at the cursor, `Space` and `Backspace`. Middle-drag, pinch and `Cmd+S` rest on unit tests of `attachInput`'s helpers and need a check by hand.)
- [x] The canvas is crisp at DPR 2 and after browser zoom; the backing store equals CSS size × dpr.
- [x] Toasts appear and disappear after 3 s.
- [x] Closing the tab after drawing shows the browser's leave warning; a fresh page does not (spec §7.0).
- [x] The shell knows no editor internals. `grep -rn "from \"@fm/editor" packages/web/src` shows only the names listed in Contract extensions item 4. Panels import only types from `@fm/editor` and change nothing except through `send`.
- [x] Every finding is in the sprint log and in design memory (README working rule 5).

## Gate 4

Follow the [README gate protocol](README.md#gate-protocol) with report `docs/reports/gate-4-web-shell.md`.

Extra verification commands:

```bash
pnpm check
pnpm e2e
pnpm dev   # manual checklist of Task 4.11 Step 8, plus demo steps 2, 3 and 6
```

Performance probe: open the demo room plus the divider in Chrome. Record 5 s of dragging a joint in DevTools → Performance. Report the median and worst frame times, and the share spent in `update` versus `drawScene`.

The report must answer:
1. **Input feel:** do `Shift` (orthogonal) and `Ctrl` (bypass) behave as expected on mouse and trackpad? Do typed lengths work with `Shift` held on the user's keyboard layout? Do `Enter` and `Space` both confirm? Does pinch zoom around the cursor without zooming the page?
2. **Frame time** while dragging on the demo document, and whether rAF coalescing was enough.
3. **Shell leaks:** did the shell ever need editor internals (state fields, tool state, camera maths beyond `worldToScreen`)? Each case should have become a ViewModel or `Scene` field instead. List them.
4. **Contract extensions:** confirm or revise each item below (render-effect camera, server sink, key normalization, store additions, editor exports), and say whether the spec (§5.2 effects, §6) should change.
5. **Text for phase 5:** what zone tags and helper dimensions need from text rendering (multi-line tags, background plates behind text, bold names, measured widths matching drawn widths).
6. **Risks for phase 5:** tag hit-testing through `host.textMetrics`, the properties rename flow (blur/Enter/Escape), and anything the smoke test could not cover.

## Contract extensions

1. **`createEffectRunner` deps** (deviation from README `@fm/web`). `server` is `ServerEffectSink | null`, where `ServerEffectSink = (effect: ServerEffect) => void` and `ServerEffect = Extract<Effect, { type: "workspace" | "submit" | "presence" }>`, instead of `WsServer | null`: `ClientMessage` only exists from phase 6. Phase 7 builds the sink from `createWsServer(...)` by mapping each effect to a `ClientMessage`. Resolved while planning: the `render` effect carries `camera` (spec §5.2), so no `getCamera` dep exists.
2. **`EditorStore`** adds `getState(): EditorState` (tests and diagnostics only; the runner takes the camera from the render effect) and `publishView(view: ViewModel): void` (the runner's `onView`). `getView()` returns a `ViewModel`, never null: the store builds one from the initial state. (revised at review: the README contract said `ViewModel | null`)
3. **Input normalization.** The shell sends key values verbatim except `Digit0`–`Digit9` and `Numpad0`–`Numpad9` codes, which become the digit, and `Period` and `NumpadDecimal` codes, which become `"."`. Without this, typed lengths fail while `Shift` is held (demo step 2) and on non-US layouts.
4. **Required `@fm/editor` index exports** used by the web shell: values `update`, `initialState`, `buildViewModel`, `worldToScreen`, `COLORS`, `UI_FONT`; types `Host`, `FontSpec`, `Event`, `Effect`, `EditorState`, `ViewModel`, `Field`, `Scene`, `Primitive`, `Width`, `Camera`, `Mods`, `UiAction`, `ToolName`.
5. **New web exports:**
   - `Timers` type (`adapters/timers.ts`).
   - `fontString` (`adapters/web-host.ts`).
   - `DrawContext`, `widthPx`, `drawScene` and `backingSize` (`adapters/canvas2d-renderer.ts`).
   - `normalizeKey`, `pressButton`, `heldButton`, `canvasPoint`, `pointerEvent`, `wheelEvent`, `keyEvent`, `isEditableTarget` and `shouldPreventDefault` (`adapters/input.ts`).
   - `displayNameFrom` and `tabClientId` (`identity.ts`).
   - `PanelProps` and `ViewProps` (`panels/types.ts`).
6. **Primitive units** assumed by the renderer:
   - `dash` values are screen pixels.
   - `arc.radius` is in metres.
   - `arc.from`/`to` and `text.rotation` are world radians, counter-clockwise.
   - `text` has baseline `middle`, family `UI_FONT` and weight 400.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | all | process | Lean mode from this phase (user, after Gate 3): waves back to back, no reviews for glue code, no mutation checks | Phase 4 ran as 4 waves, 9 agents, no reviews (all glue) | `process.md` |
| 2026-09-29 | 4.10 | deviation | React 19 prints `readOnly=""`, the test expected `readonly=""` | Assertions match case-insensitively; the negative check is now meaningful | none (test-only) |
| 2026-09-29 | 4.12 | note | `playwright install chromium` removed an older headless Chromium from the shared user cache | None; other Playwright installs may re-download | none |
| 2026-09-29 | 4.11 | check | Manual checklist run by the controller with a Playwright script (real mouse/keyboard, DPR 2): demo steps 2, 3, 6, undo/redo, zoom, pan, toast, Space, Backspace, leave warning | All pass; an invalid drag shows the last valid position in red (by design, `tools/types.ts`) | none |
