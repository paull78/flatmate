import { expect, test } from "@playwright/test";
import { textWidth } from "@fm/editor";
import { canvasOf } from "./support/app-driver";

// The bundled Inter (render.15; AC-02, AC-04): the page loads it from its own origin before the first draw, and the
// core's table measures what Chromium draws with it, unkerned. document.fonts.check() proves nothing (it is true for a
// family that isn't there), so the spec reads the font set itself.

const STRINGS = [
  "Living", "Bedroom", "Kitchen", "Bath", "Hall", "Studio", "Loft +2.15", "Platform +0.45", "Wardrobe", "Roll-out bed",
  "22.0 m²", "7.84 m²", "10.64 m²", "9.91 m²", "115.64 m²", "2.80 × 2.80 m", "3.40 × 2.85 m", "5.80 × 3.80 m",
  "0.90", "1.20", "3.00", "3.48", "4.00", "6.00", "12.75", "0.45", "2.15", "Free 61 %", "Night", "Day",
];

test("the page draws with its own Inter, and the core's table measures it (AC-02, AC-04)", async ({ page }) => {
  const fonts: string[] = []; // the face's fetch, not Vite's module request for the ?url import
  page.on("request", (r) => {
    if (r.resourceType() === "font") fonts.push(r.url());
  });
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  await expect(canvasOf(page)).toBeVisible();
  const faces = await page.evaluate(() => [...document.fonts].map((f) => ({ family: f.family.replaceAll('"', ""), status: f.status })));
  expect(faces).toContainEqual({ family: "Inter", status: "loaded" });
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) expect(new URL(url).origin).toBe(new URL(page.url()).origin);

  const measured = await page.evaluate((strings) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.font = "12px Inter";
    ctx.fontKerning = "none";
    return strings.map((s) => ctx.measureText(s).width);
  }, STRINGS);
  STRINGS.forEach((s, i) => {
    const table = textWidth("inter", s, 12);
    expect(Math.abs((measured[i] ?? 0) - table) / table, `${s}: canvas ${measured[i]}, table ${table}`).toBeLessThanOrEqual(0.005);
  });
});

test("the app appears only once the font has arrived (render.15)", async ({ page }) => {
  // Timed inside the page: page.goto waits for the load event, which itself waits for the font.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector("canvas")) {
        Reflect.set(window, "__canvasAt", performance.now());
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  let served = 0; // when the delayed font went out, epoch ms
  await page.route(/Inter-Regular[^/]*\.ttf/, async (route) => {
    if (route.request().resourceType() !== "font") return route.continue();
    await new Promise((done) => setTimeout(done, 1000)); // a slow font
    served = Date.now();
    return route.continue();
  });
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  await expect(canvasOf(page)).toBeVisible({ timeout: 10_000 });
  const { canvasAt, origin } = await page.evaluate(() => ({ canvasAt: Number(Reflect.get(window, "__canvasAt")), origin: performance.timeOrigin }));
  expect(served).toBeGreaterThan(0);
  expect(origin + canvasAt).toBeGreaterThanOrEqual(served);
});
