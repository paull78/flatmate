import type { PageImage } from "@fm/editor";

// A page's images on a canvas (sheetset.21). A page draws at once and a JPEG decodes later, so an image not ready paints
// itself when it is, on the canvas that asked, unless that canvas has been drawn again since. It lies above everything on
// the page and outside its clips, so painting it needs no redraw: nothing is rebuilt, and nothing can loop.

type Rect = PageImage["rect"];
/** Generic like `createPictureCache`, so tests need no DOM. */
export type ImageContext<T> = { drawImage(image: T, dx: number, dy: number, dw: number, dh: number): void };
type Entry<T> = { jpeg: string; image: T; ready: boolean; waiting: (() => void)[] };

/** `load` starts a decode and calls back when it's done, never on an error. Keeps one decoded image: a project has one logo. */
export function createPageImages<T>(load: (src: string, onLoad: () => void) => T) {
  let entry: Entry<T> | null = null;
  const lastDraw = new WeakMap<ImageContext<T>, object>();

  const entryOf = (jpeg: string): Entry<T> => {
    if (entry?.jpeg === jpeg) return entry;
    const image = load(`data:image/jpeg;base64,${jpeg}`, () => {
      made.ready = true;
      for (const paint of made.waiting.splice(0)) paint();
    });
    const made: Entry<T> = { jpeg, image, ready: false, waiting: [] };
    entry = made;
    return made;
  };

  /** `place` turns a page rect into this canvas's pixels. Call it for every draw, with no images too: it ends any wait. */
  return (ctx: ImageContext<T>, images: readonly PageImage[], place: (rect: Rect) => Rect): void => {
    const draw = {};
    lastDraw.set(ctx, draw);
    for (const { rect, jpeg } of images) {
      const shown = entryOf(jpeg);
      const paint = (): void => {
        const { x, y, w, h } = place(rect);
        ctx.drawImage(shown.image, x, y, w, h);
      };
      if (shown.ready) paint();
      else shown.waiting.push(() => {
        if (lastDraw.get(ctx) === draw) paint();
      });
    }
  };
}
