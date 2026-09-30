import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { clickAt, moveTo } from "./support/canvas";
import { canvasOf, drawDemoApartment, helperLabelPage, openProject, waitSaved, worldToPage } from "./support/demo-driver";

// Reference images of demo steps 4–7 (restored phase 8 Task 8.6, S1.0). Runs only with FM_SCREENSHOTS=1 against a
// running `pnpm demo`, so `pnpm e2e` never overwrites the committed images. FM_RENDERER=webgl draws with WebGL.
const RENDERER = process.env.FM_RENDERER === "webgl" ? "webgl" : "canvas2d";
const OUT = fileURLToPath(new URL(`../../../docs/reports/screenshots/${RENDERER}/`, import.meta.url));
const APP = process.env.RM_APP_URL ?? "http://localhost:5173";
const CONTEXT = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }; // fixed size and DPR

test.skip(!process.env.FM_SCREENSHOTS, "run with FM_SCREENSHOTS=1 while `pnpm demo` is running");

test("demo screenshots: zones, helper editing, invalid drag, two windows", async ({ browser }) => {
  const project = `Apartment ${Date.now()}`;

  const aliceContext = await browser.newContext(CONTEXT);
  const alice = await aliceContext.newPage();
  await alice.goto(`${APP}/?name=Alice&renderer=${RENDERER}`);
  await openProject(alice, project);

  // Steps 2–4
  await drawDemoApartment(alice);
  await expect(alice.locator('[data-field-id="area"]')).toHaveValue("10.64 m²"); // canvas text is not in the DOM
  await alice.screenshot({ path: `${OUT}room-with-zones.png` });

  // Step 5, before Enter
  await alice.keyboard.press("v");
  await clickAt(alice, canvasOf(alice), { x: 6, y: 2 });
  const helper = await helperLabelPage(alice, { x: 6, y: 0 }, { x: 6, y: 4 });
  await alice.mouse.click(helper.x, helper.y);
  await alice.keyboard.type("3.5");
  await alice.screenshot({ path: `${OUT}helper-editing.png` });
  await alice.keyboard.press("Enter");
  await waitSaved(alice); // the drag below cannot start while the resize is outstanding

  // Step 6, while the pointer is still down
  const joint = await worldToPage(alice, { x: 6, y: 3.5 });
  const through = await worldToPage(alice, { x: 4, y: 2.8 });
  const invalid = await worldToPage(alice, { x: 2, y: 2 });
  await alice.mouse.move(joint.x, joint.y);
  await alice.mouse.down();
  await alice.mouse.move(through.x, through.y, { steps: 5 });
  await alice.mouse.move(invalid.x, invalid.y, { steps: 5 });
  await alice.screenshot({ path: `${OUT}invalid-drag.png` });
  await alice.mouse.up();
  await expect(alice.getByText("Walls can't cross")).toBeVisible();

  // Step 7
  const bobContext = await browser.newContext(CONTEXT);
  const bob = await bobContext.newPage();
  await bob.goto(`${APP}/?name=Bob&renderer=${RENDERER}`);
  await openProject(bob, project);
  await moveTo(bob, canvasOf(bob), { x: 4.5, y: 1 });
  await expect(alice.getByTestId("collaborators")).toContainText("Bob");
  await alice.waitForTimeout(300); // Bob's last position leaves after the 50 ms presence throttle; canvas text is not in the DOM
  await alice.screenshot({ path: `${OUT}two-windows-alice.png` });
  await bob.screenshot({ path: `${OUT}two-windows-bob.png` });

  await aliceContext.close();
  await bobContext.close();
});
