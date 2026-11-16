import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { clickAt, drawRectRoom, moveTo, typeLength } from "./support/canvas";
import { canvasOf, helperLabelPage, openProject } from "./support/app-driver";
import { SERVER } from "./support/server";

// The value input (C6, tidy.14): while a value field is open, a hidden input marked `data-editor-keys` holds the focus,
// so a keyboard extension leaves the digits alone; its keys still reach the editor.

/**
 * A stand-in keyboard extension (Vimium-like): a capture-phase window listener that swallows digits and "." aimed at
 * anything not editable.
 */
function installStandIn(): void {
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      const editable = t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (!editable && /^[0-9.]$/.test(e.key)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

async function openLocal(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  await expect(canvasOf(page)).toBeVisible();
}

const valueInput = (page: Page) => page.getByTestId("value-input");
const lengthField = (page: Page) => page.locator('[data-field-id="length"]');

test("a stand-in extension can't eat typed digits (AC-11)", async ({ page }) => {
  await page.addInitScript(installStandIn);
  await openLocal(page);
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 6, 4); // clicks only: corners (0,0) and (6,4)

  // A wall helper: the right wall (6,0) → (6,4), clear length 3.80 between the faces.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 6, y: 2 });
  await expect(lengthField(page)).toHaveValue("4.00");
  const helper = await helperLabelPage(page, { x: 6, y: 0 }, { x: 6, y: 4 });
  await page.mouse.click(helper.x, helper.y);
  await typeLength(page, "3.3");
  await expect(lengthField(page)).toHaveValue("3.49"); // 3.30 clear once the top wall slopes (tidy.45); 4.00 if the digits were eaten
  await page.keyboard.press("Escape");

  // A typed Wall length, below the room.
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: -1 });
  await moveTo(page, canvas, { x: 3, y: -1 });
  await typeLength(page, "2.5");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, { x: 1, y: -1 });
  await expect(lengthField(page)).toHaveValue("2.50");
});

test("the value input has focus after a canvas press in the Wall tool, and exists only while a value is typed (AC-11, AC-12)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await expect(valueInput(page)).toHaveCount(0);
  await page.keyboard.press("w");
  await expect(valueInput(page)).toHaveCount(0);
  await clickAt(page, canvas, { x: 0, y: 0 });
  await expect(valueInput(page)).toBeFocused();
  await clickAt(page, canvas, { x: 2, y: 0 });
  await expect(valueInput(page)).toBeFocused();
  await expect(valueInput(page)).toHaveValue(""); // the editor holds the text
  await page.keyboard.type("1.2");
  await expect(page.getByTestId("command-value")).toHaveText("1.2");
  await expect(valueInput(page)).toHaveValue("");
  // Text inserted as IME or a soft keyboard would: refused before it fills the input (no input event), never read.
  await valueInput(page).evaluate((el) => el.addEventListener("input", () => el.setAttribute("data-filled", "")));
  await page.keyboard.insertText("5");
  await expect(valueInput(page)).toHaveValue("");
  await expect(valueInput(page)).not.toHaveAttribute("data-filled");
  await expect(page.getByTestId("command-value")).toHaveText("1.2");
  await page.keyboard.press("Escape");
  await expect(valueInput(page)).toHaveCount(0);
});

test("mid-chain the Thickness field keeps its focus, also when the segment's acceptance remounts the input (AC-12)", async ({ page }) => {
  // Holds the server's messages while `held` is set, so the chain stays paused while the Thickness field is clicked.
  let held: (string | Buffer)[] | null = null;
  const clients: WebSocketRoute[] = [];
  await page.routeWebSocket(
    (url) => url.href.startsWith(SERVER),
    (ws) => {
      clients.push(ws);
      const server = ws.connectToServer();
      server.onMessage((m) => {
        if (held !== null) held.push(m);
        else ws.send(m);
      });
    },
  );
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=canvas2d`);
  await openProject(page, `Keys ${Date.now()}`);
  const canvas = canvasOf(page);
  const thickness = page.getByTestId("wall-thickness");

  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await clickAt(page, canvas, { x: 2, y: 0 });
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");
  await expect(valueInput(page)).toBeFocused();

  held = [];
  await clickAt(page, canvas, { x: 2, y: 2 }); // submitted: the chain pauses until the server accepts
  await expect(valueInput(page)).toHaveCount(0);
  await thickness.click();
  await thickness.selectText();
  await page.keyboard.type("0.3");
  const messages: (string | Buffer)[] = held;
  held = null;
  for (const m of messages) for (const ws of clients) ws.send(m);
  await expect(valueInput(page)).toHaveCount(1); // drawing again: the input remounted
  await expect(thickness).toBeFocused();
  await expect(thickness).toHaveValue("0.3");

  await page.keyboard.press("Enter"); // commits; DraftInput's Enter blurs the field, as in every panel
  await expect(thickness).toHaveValue("0.30");
  await expect(valueInput(page)).toBeFocused(); // the blurred field hands the focus back to the open value input

  await clickAt(page, canvas, { x: 0, y: 2 });
  await expect(valueInput(page)).toBeFocused();
});

test("shortcuts typed into the value input still work (AC-12)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 6, 4);

  // A helper edit: Escape ends it.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 6, y: 2 });
  const helper = await helperLabelPage(page, { x: 6, y: 0 }, { x: 6, y: 4 });
  await page.mouse.click(helper.x, helper.y);
  await expect(valueInput(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(valueInput(page)).toHaveCount(0);

  // A chain: V switches tool.
  const bar = page.getByTestId("floating-bar");
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: -1 });
  await expect(valueInput(page)).toBeFocused();
  await page.keyboard.press("v");
  await expect(bar.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  await expect(valueInput(page)).toHaveCount(0);

  // A chain with a wall drawn: Cmd/Ctrl+Z undoes it and drops the chain.
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: -1 });
  await clickAt(page, canvas, { x: 2, y: -1 });
  await expect(valueInput(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(valueInput(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, { x: 1, y: -1 });
  await expect(lengthField(page)).toHaveCount(0); // the wall is gone
});

/** A Vimium-like insert mode: Escape aimed at an editable element is stopped in the capture phase and blurs it. */
function installEscapeBlur(): void {
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (e.key !== "Escape" || !(t instanceof HTMLElement) || t.tagName !== "INPUT") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      t.blur();
    },
    true,
  );
}

/** An extension that swallows only Escape's keydown aimed at an editable element; its keyup passes. */
function installEscapeSwallow(): void {
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (e.key !== "Escape" || !(t instanceof HTMLElement) || t.tagName !== "INPUT") return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

test("Escape ends a helper edit when an extension takes it and blurs the input (tidy.42)", async ({ page }) => {
  await page.addInitScript(installEscapeBlur);
  await openLocal(page);
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 6, y: 2 });
  const helper = await helperLabelPage(page, { x: 6, y: 0 }, { x: 6, y: 4 });
  await page.mouse.click(helper.x, helper.y);
  await expect(valueInput(page)).toBeFocused();
  await page.keyboard.type("3.3");
  await page.keyboard.press("Escape");
  await expect(valueInput(page)).toHaveCount(0);
  await expect(lengthField(page)).toHaveValue("4.00"); // nothing applied
});

test("Escape ends the Wall chain when an extension swallows only its keydown (tidy.42)", async ({ page }) => {
  await page.addInitScript(installEscapeSwallow);
  await openLocal(page);
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await expect(valueInput(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(valueInput(page)).toHaveCount(0);
  await expect(page.getByTestId("command-bar")).toContainText("First point");
});
