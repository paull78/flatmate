import type { ViewProps } from "./types";

export function Toast({ view }: ViewProps) {
  if (view.toast === null) return null;
  return (
    <div className="toast fm-toast" role="status">
      {view.toast}
    </div>
  );
}
