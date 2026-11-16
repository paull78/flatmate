import type { UiAction, ViewModel } from "@fm/editor";
import { guardClosedSelect } from "./select-keys";

type Props = { menu: NonNullable<ViewModel["view3d"]>["surroundings"]; send(action: UiAction): void };

/**
 * The 3D panel's surroundings menu (surroundings.06, .15): a native select, as a custom menu would be clipped by the
 * frame. It sends the drawing's setting, which works with something selected, and blurs after a pick: the window key
 * listener drops keys aimed at a SELECT, so Cmd+Z would otherwise do nothing. No keepFocus, as preventing the mouse down
 * stops a native select opening. A close with no change keeps the focus here, so stray keys are guarded
 * (`guardClosedSelect`, shared by every dropdown).
 */
export function SurroundingsMenu({ menu, send }: Props) {
  return (
    <select
      className="surroundings-menu"
      data-testid="surroundings-menu"
      aria-label="Surroundings"
      title="Surroundings"
      value={menu.value}
      disabled={!menu.canEdit}
      onChange={(e) => {
        send({ type: "setSheetSetting", key: "surroundings", value: e.currentTarget.value });
        e.currentTarget.blur();
      }}
      onKeyDown={guardClosedSelect}
    >
      {menu.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
