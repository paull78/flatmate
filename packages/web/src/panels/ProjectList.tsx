import { useState, type FormEvent } from "react";
import type { UiAction, ViewModel } from "@fm/editor";

type Props = { list: NonNullable<ViewModel["projectList"]>; send(action: UiAction): void };

/** The project list (spec §1.4 step 1, §7.2.1). It renders the ViewModel and sends ui events only. */
export function ProjectList({ list, send }: Props) {
  const [name, setName] = useState("");

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
          <li key={p.id}>
            <button type="button" data-project-id={p.id} onClick={() => send({ type: "openProject", id: p.id })}>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
