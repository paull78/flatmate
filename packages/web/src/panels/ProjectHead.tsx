import type { ViewProps } from "./types";

/** The top of the palette column (ux-polish item 7): the drawing's name and its save status. */
export function ProjectHead({ view }: ViewProps) {
  const project = view.project;
  return (
    <div className="side-head project-head" data-testid="project-head">
      <span className="app-logo" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 17V3h14v14z M10 3v8" />
        </svg>
      </span>
      <span className="project-name" data-testid="project-name">{project?.name ?? "No drawing open"}</span>
      {project !== null ? (
        <span className="project-status" data-testid="project-status" data-status={project.status}>{project.status}</span>
      ) : null}
    </div>
  );
}
