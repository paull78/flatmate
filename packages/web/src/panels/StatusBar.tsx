import type { ViewProps } from "./types";

export function StatusBar({ view }: ViewProps) {
  const project = view.project;
  return (
    <footer className="status-bar fm-statusbar">
      <span className="project-name" data-testid="project-name">{project?.name ?? "No drawing open"}</span>
      {project !== null ? (
        <span className="project-status" data-testid="project-status" data-status={project.status}>{project.status}</span>
      ) : null}
      <ul className="collaborators" data-testid="collaborators" aria-label="Collaborators">
        {view.presence.map((p) => (
          <li key={p.clientId}>
            <span className="swatch" style={{ background: p.color }} />
            {p.name}
          </li>
        ))}
      </ul>
    </footer>
  );
}
