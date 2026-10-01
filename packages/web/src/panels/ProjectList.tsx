import { useState, type FormEvent } from "react";
import type { UiAction, ViewModel } from "@fm/editor";
import type { ProjectMeta } from "@fm/protocol";

type Props = { list: NonNullable<ViewModel["projectList"]>; send(action: UiAction): void };

/** The project list (spec §1.4 step 1, §7.2.1). It renders the ViewModel and sends ui events only. */
export function ProjectList({ list, send }: Props) {
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // the project whose delete is being asked

  const create = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    send({ type: "createProject", name: trimmed });
    setName("");
  };

  return (
    <section className="project-list fm-projectlist" data-testid="project-list">
      <h1>Projects</h1>
      <form onSubmit={create}>
        <input aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {list.loading ? <p className="muted">Loading…</p> : null}
      {list.error !== null ? (
        <p className="error" role="alert">
          {list.error}
        </p>
      ) : null}
      {list.items.length === 0 && !list.loading ? <p className="muted">No projects yet</p> : null}
      <ul>
        {list.items.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            confirming={confirming === p.id}
            onAsk={() => setConfirming(p.id)}
            onCancel={() => setConfirming(null)}
            send={send}
          />
        ))}
      </ul>
    </section>
  );
}

type RowProps = { project: ProjectMeta; confirming: boolean; onAsk(): void; onCancel(): void; send(action: UiAction): void };

/** One project: open it, or delete it after a question asked in place (no browser dialog, spec §7.2.1). */
export function ProjectRow({ project, confirming, onAsk, onCancel, send }: RowProps) {
  if (confirming) {
    return (
      <li className="project-row confirming">
        <p>Delete “{project.name}”? Anyone who has it open is sent back to the project list.</p>
        <div className="project-row-actions">
          <button
            type="button"
            className="danger"
            data-confirm-delete={project.id}
            onClick={() => {
              onCancel();
              send({ type: "deleteProject", id: project.id });
            }}
          >
            Delete
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="project-row">
      <button type="button" className="project-open" data-project-id={project.id} onClick={() => send({ type: "openProject", id: project.id })}>
        {project.name}
      </button>
      <button type="button" className="project-delete" data-delete-id={project.id} onClick={onAsk}>
        Delete
      </button>
    </li>
  );
}
