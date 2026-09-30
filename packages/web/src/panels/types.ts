import type { UiAction, ViewModel } from "@fm/editor";

export type PanelProps = { view: ViewModel; send(action: UiAction): void };
export type ViewProps = { view: ViewModel };
