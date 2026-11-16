import type { ViewProps } from "./types";

/** The top of the Properties column (ux-polish item 7): one avatar per collaborator, the name as its tooltip. */
export function PresenceHead({ view }: ViewProps) {
  return (
    <div className="side-head presence-head">
      <ul className="collaborators" data-testid="collaborators" aria-label="Collaborators">
        {view.presence.map((p) => (
          <li key={p.clientId} title={p.name}>
            <span className="avatar" style={{ background: p.color }} aria-hidden="true">
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="collaborator-name">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
