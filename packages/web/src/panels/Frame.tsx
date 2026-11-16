import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { keepFocus } from "./keep-focus";

// What the frames under the plan share (section.45, .46): one title bar, its icon buttons, the gaps that resize them,
// and the swap's short move.

const ICONS = {
  swap: "M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3",
  larger: "M9.5 2H14v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5",
  smaller: "M14 6.5H9.5V2M9.5 6.5 14 2M2 9.5h4.5V14M6.5 9.5 2 14",
  close: "m4 4 8 8M12 4l-8 8",
  left: "M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3",
  right: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3",
  corner: "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3M8.5 8.5H12V11H8.5z",
  roof: "M1.5 8.5 8 3l6.5 5.5M4 7v6h8V7",
} as const;

type FrameButtonProps = { icon: keyof typeof ICONS; title: string; action: string; testId?: string; pressed?: boolean; onClick(): void };

export function FrameButton({ icon, title, action, testId, pressed, onClick }: FrameButtonProps) {
  return (
    <button type="button" className="frame-button" data-action={action} data-testid={testId} title={title} aria-label={title} aria-pressed={pressed} onMouseDown={keepFocus} onClick={onClick}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={ICONS[icon]} />
      </svg>
    </button>
  );
}

type FrameHeadProps = { label: string; layout: string; onDoubleClick?: (() => void) | undefined; children: ReactNode };

/** A frame's title bar: its name and layout on the left, its own controls after them. A double-click on the bar itself, not a control, makes it larger. */
export function FrameHead({ label, layout, onDoubleClick, children }: FrameHeadProps) {
  const onBar = (e: { target: EventTarget }) => {
    if (e.target instanceof Element && e.target.closest("button, select") === null) onDoubleClick?.();
  };
  return (
    <div className="frame-head" onDoubleClick={onBar}>
      <span className="frame-title">
        {label} <small>· {layout}</small>
      </span>
      {children}
    </div>
  );
}

export const FrameSeparator = () => <span className="frame-separator" aria-hidden="true" />;

/** The size of `ref`'s element, once it has one, following it as it changes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = () => setSize(el.clientWidth > 0 && el.clientHeight > 0 ? { w: el.clientWidth, h: el.clientHeight } : null);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

type SashProps = { across: "height" | "width"; testId: string; title: string; onMove(point: { x: number; y: number }): void; onDoubleClick?: () => void };

/** A grey gap that a drag moves, reporting where its centre goes, so it keeps its place under the pointer. Only a move reports, so a click or a double-click changes nothing by itself. */
export function FrameSash({ across, testId, title, onMove, onDoubleClick }: SashProps) {
  const grab = useRef<{ x: number; y: number } | null>(null); // the gap's centre from the pointer, while dragging
  const [active, setActive] = useState(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    grab.current = { x: r.x + r.width / 2 - e.clientX, y: r.y + r.height / 2 - e.clientY };
    setActive(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (grab.current !== null) onMove({ x: e.clientX + grab.current.x, y: e.clientY + grab.current.y });
  };
  const up = () => {
    grab.current = null;
    setActive(false);
  };
  return (
    <div
      className={`frame-sash frame-sash-${across}${active ? " frame-sash-active" : ""}`}
      data-testid={testId}
      role="separator"
      aria-orientation={across === "height" ? "horizontal" : "vertical"}
      title={title}
      onMouseDown={keepFocus}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onDoubleClick}
    />
  );
}

/** Runs `change`, then moves the dock's frames from where they were to where they are now. Chrome, so a short move; none if asked for less motion. */
export function moveFrames(dock: HTMLElement | null, change: () => void): void {
  if (dock === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  const frames = [...dock.querySelectorAll<HTMLElement>(":scope > .frame")];
  const before = frames.map((f) => f.getBoundingClientRect());
  change();
  requestAnimationFrame(() => {
    frames.forEach((f, i) => {
      const [from, to] = [before[i], f.getBoundingClientRect()];
      if (from === undefined || to.width === 0 || to.height === 0) return;
      f.animate([{ transformOrigin: "0 0", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 200, easing: "cubic-bezier(.2, .7, .2, 1)" });
    });
  });
}
