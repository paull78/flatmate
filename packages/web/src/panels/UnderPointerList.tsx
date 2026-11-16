import { useLayoutEffect, useRef, useState } from "react";
import type { UiAction, ViewModel } from "@fm/editor";

type List = NonNullable<ViewModel["underPointer"]>;
type Size = { width: number; height: number };

/** Where a menu of `menu`'s size goes for a press at `at`: at the pointer, moved back in where it would leave `stage`. */
export function keptOnStage(at: { x: number; y: number }, menu: Size, stage: Size): { left: number; top: number } {
  return { left: Math.max(0, Math.min(at.x, stage.width - menu.width)), top: Math.max(0, Math.min(at.y, stage.height - menu.height)) };
}

/**
 * What's under the pointer (AC-06): a menu at the pointer, one row per thing there. Hovering or focusing a row marks it on
 * the plan; a click selects it. The editor closes it on Esc, the wheel or a press on the canvas.
 */
export function UnderPointerList({ list, send }: { list: List; send(a: UiAction): void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: list.at.x, top: list.at.y });
  useLayoutEffect(() => {
    const el = menu.current;
    const stage = el?.parentElement;
    if (el && stage) setPlace(keptOnStage(list.at, { width: el.offsetWidth, height: el.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight }));
  }, [list.at, list.rows.length]);
  return (
    <div
      ref={menu}
      className="under-pointer"
      role="menu"
      aria-label="What's under the pointer"
      data-testid="under-pointer"
      style={place}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => send({ type: "hoverUnderPointer", ref: null })}
    >
      {list.rows.map((row) => (
        <button
          key={row.key}
          type="button"
          role="menuitem"
          data-row={row.key}
          aria-current={row.selected ? "true" : undefined}
          onClick={() => send({ type: "pickUnderPointer", ref: row.ref })}
          onMouseEnter={() => send({ type: "hoverUnderPointer", ref: row.ref })}
          onFocus={() => send({ type: "hoverUnderPointer", ref: row.ref })}
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}
