import type { ViewProps } from "./types";

export function CommandBar({ view }: ViewProps) {
  const { prompt, value, unit } = view.commandBar;
  return (
    <div className="command-bar fm-commandbar" data-testid="command-bar">
      <span className="command-prompt">{prompt}</span>
      <span className="command-value" data-testid="command-value">{value}</span>
      {unit !== null && value !== "" ? <span className="command-unit">{unit}</span> : null}
    </div>
  );
}
