import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { ExportPage, SheetRow, UiAction } from "@fm/editor";
import { backingShift, dragDelta, dragTo, frameBoxes, paperDrag, pressAt, type PageDrag, type Px } from "./page-drag";
import { pageBackingSize, pageCssSize } from "./sheet-canvas";

/** Draws a page at a pixel size on a 2D context: the caller sizes the canvas and fills the paper. `shift` moves the plan inside its frame, in those pixels. */
export type DrawPage = (ctx: CanvasRenderingContext2D, page: ExportPage, size: { w: number; h: number }, shift?: Px | null) => void;

type PageSize = { widthMm: number; heightMm: number };

function paint(canvas: HTMLCanvasElement, page: ExportPage, drawPage: DrawPage, shift: Px | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawPage(ctx, page, { w: canvas.width, h: canvas.height }, shift);
  canvas.dataset["draws"] = String(Number(canvas.dataset["draws"] ?? 0) + 1);
}

type CanvasProps = { page: ExportPage | null; css: { w: number; h: number }; drawPage: DrawPage; testId: string; canvasRef?: RefObject<HTMLCanvasElement | null>; settled?: number };

/**
 * A page on a canvas of `css` pixels, sharp at the screen's ratio. A thumbnail is the same page, smaller (sheetset.13).
 * `settled` asks for the page as it stands, after a drag drew over it and may have been refused.
 */
export function PageCanvas({ page, css, drawPage, testId, canvasRef, settled = 0 }: CanvasProps) {
  const own = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? own;
  const drawn = useRef<{ page: ExportPage; w: number; h: number; settled: number } | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || page === null) return;
    // Scrolling back to an unchanged page finds it already drawn.
    if (drawn.current?.page === page && drawn.current.w === css.w && drawn.current.h === css.h && drawn.current.settled === settled) return;
    drawn.current = { page, w: css.w, h: css.h, settled };
    const backing = pageBackingSize(css, window.devicePixelRatio);
    canvas.width = backing.w;
    canvas.height = backing.h;
    paint(canvas, page, drawPage, null);
  }, [page, css.w, css.h, drawPage, ref, settled]);
  return <canvas ref={ref} className="sheet-canvas" data-testid={testId} style={{ width: css.w, height: css.h }} />;
}

/** Whether an element is on screen. Pages and thumbnails build and draw only then: the tree holds every sheet, and a large drawing's page takes a while. */
export function useOnScreen(host: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [host]);
  return onScreen;
}

type Framing = { onStart(): void; onLetGo(mm: { dxMm: number; dyMm: number }): void };

/**
 * A drag on a page's frame. It's this page's own until let go (sheetset.17): each frame redraws the page with the plan
 * shifted inside its clip, at most one per frame, and nothing's committed or built until the one command on release.
 */
function FramedPage({ page, css, drawPage, framing }: { page: ExportPage | null; css: { w: number; h: number }; drawPage: DrawPage; framing: Framing }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<PageDrag | null>(null);
  const frame = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(0);
  const stopFrame = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stopFrame, []);
  const drawLive = (): void => {
    frame.current = null;
    const el = canvas.current;
    if (el && page && drag.current) paint(el, page, drawPage, backingShift(dragDelta(drag.current), el.width, css.w));
  };
  const at = (e: PointerEvent): Px => ({ x: e.clientX, y: e.clientY });
  const move = (e: PointerEvent): void => {
    if (!drag.current) return;
    const next = dragTo(drag.current, at(e));
    if (next.dragging && !drag.current.dragging) {
      setDragging(true);
      framing.onStart(); // a page dragged is selected, with its ring on while it moves
    }
    drag.current = next;
    if (next.dragging && frame.current === null) frame.current = requestAnimationFrame(drawLive);
  };
  const end = (commit: boolean, e: PointerEvent): void => {
    const last = drag.current && dragTo(drag.current, at(e));
    drag.current = null;
    stopFrame();
    if (!last?.dragging || !page) return;
    setDragging(false);
    setSettled((n) => n + 1);
    if (commit) framing.onLetGo(paperDrag(dragDelta(last), css.w / page.widthMm));
  };
  return (
    <div className="sheets-page" style={{ width: css.w, height: css.h }}>
      <PageCanvas page={page} css={css} drawPage={drawPage} testId="sheet-canvas" canvasRef={canvas} settled={settled} />
      {page
        ? frameBoxes(page, css).map((box, i) => (
            <div
              key={i}
              className={dragging ? "sheets-frame dragging" : "sheets-frame"}
              data-testid="sheet-frame"
              style={box}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = pressAt(at(e));
              }}
              onPointerMove={move}
              onPointerUp={(e) => end(true, e)}
              onPointerCancel={(e) => end(false, e)}
            />
          ))
        : null}
    </div>
  );
}

type PagesProps = { sheet: SheetRow; size: PageSize; zoom: number; drawPage: DrawPage; framing: Framing };

/** One of a sheet's pages, drawn while on screen, so a long report draws only what's seen. Off screen it keeps what it last drew until it's seen again. */
function SheetPageAt({ index, sheet, size, zoom, drawPage, framing }: PagesProps & { index: number }) {
  const host = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(host);
  const page = onScreen ? (sheet.pages()[index] ?? null) : null;
  return (
    <div ref={host}>
      <FramedPage page={page} css={pageCssSize(page ?? size, zoom)} drawPage={drawPage} framing={framing} />
    </div>
  );
}

/** A sheet's real pages. The count needs nothing drawn, so pages off screen hold their place and scrolling doesn't jump. */
export function SheetPages(props: PagesProps) {
  return (
    <div className="sheets-pages">
      {Array.from({ length: props.sheet.pageCount }, (_, i) => (
        <SheetPageAt key={i} index={i} {...props} />
      ))}
    </div>
  );
}

/** The note under a page showing part of the plan: to ignore or use (sheetset.17). "Use A2" is the set's paper, the rest this sheet's. */
function SheetNote({ sheet, disabled, send }: { sheet: SheetRow; disabled: boolean; send(action: UiAction): void }) {
  const { shortcuts, id } = sheet;
  if (!sheet.partOfPlan || !shortcuts) return null;
  const { centre, fit, paper } = shortcuts;
  const drawing = sheet.kind === "section" ? "section" : "plan";
  return (
    <div className="sheets-fixes" data-testid="sheet-note">
      <span>Shows part of the {drawing}.</span>
      {centre ? (
        <button type="button" data-shortcut="centre" disabled={disabled} onClick={() => send({ type: "setSheet", id, fields: { cx: 0, cy: 0 } })}>
          Centre it
        </button>
      ) : null}
      {fit !== null ? (
        <button type="button" data-shortcut="fit" disabled={disabled} onClick={() => send({ type: "setSheet", id, fields: { scale: fit, cx: 0, cy: 0 } })}>
          Fit the whole {drawing} (1:{fit})
        </button>
      ) : null}
      {paper !== null ? (
        <button type="button" data-shortcut="paper" disabled={disabled} onClick={() => send({ type: "setSheetSetting", key: "paper", value: paper })}>
          Use {paper}
        </button>
      ) : null}
    </div>
  );
}

type DeskProps = { sheet: SheetRow; selected: boolean; size: PageSize; zoom: number; drawPage: DrawPage; readOnly: boolean; send(action: UiAction): void; onPick(): void };

/** A sheet on the desk: its header, its pages, with the blue ring when selected, and any note. A click anywhere selects it. A plain function, so tests can call it. */
export function DeskSheet({ sheet, selected, size, zoom, drawPage, readOnly, send, onPick }: DeskProps) {
  // Always there, unlike a button: read-only flips while an edit waits for its ack, and taking the frame away would end a drag. Letting go then refuses like any edit.
  const framing: Framing = { onStart: onPick, onLetGo: ({ dxMm, dyMm }) => send({ type: "frameSheet", id: sheet.id, dxMm, dyMm }) };
  return (
    <div className={selected ? "sheets-sheet picked" : "sheets-sheet"} data-sheet-id={sheet.id} onClick={onPick}>
      <div className="sheets-head">
        <span className="sheets-title">{sheet.title}</span>
        {sheet.scale !== null ? <span className="sheets-scale">1:{sheet.scale}</span> : null}
      </div>
      <SheetPages sheet={sheet} size={size} zoom={zoom} drawPage={drawPage} framing={framing} />
      <SheetNote sheet={sheet} disabled={readOnly} send={send} />
    </div>
  );
}
