import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectList, ProjectRow } from "../src/panels/ProjectList";

const send = (): void => {};

describe("ProjectList", () => {
  it("offers a create form and one button per project", () => {
    const html = renderToStaticMarkup(
      <ProjectList list={{ items: [{ id: "p1", name: "Apartment" }, { id: "p2", name: "Office" }], loading: false, error: null }} send={send} />,
    );
    expect(html).toContain('placeholder="Project name"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Create<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p1"[^>]*>Apartment<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p2"[^>]*>Office<\/button>/);
    expect(html).not.toContain("Loading");
    expect(html.match(/<button[^>]*data-delete-id="p[12]"[^>]*>Delete<\/button>/g)).toHaveLength(2);
  });

  it("asks before deleting, in the row (spec §7.2.1)", () => {
    const row = (confirming: boolean): string =>
      renderToStaticMarkup(
        <ProjectRow project={{ id: "p1", name: "Apartment" }} confirming={confirming} onAsk={send} onCancel={send} send={send} />,
      );
    expect(row(false)).not.toContain("Anyone who has it open");
    const asking = row(true);
    expect(asking).toContain("Delete “Apartment”? Anyone who has it open is sent back to the project list.");
    expect(asking).toMatch(/<button[^>]*data-confirm-delete="p1"[^>]*>Delete<\/button>/);
    expect(asking).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(asking).not.toContain('data-project-id="p1"');
  });

  it("shows loading, errors and an empty list", () => {
    const loading = renderToStaticMarkup(<ProjectList list={{ items: [], loading: true, error: null }} send={send} />);
    expect(loading).toContain("Loading");
    expect(loading).not.toContain("No projects yet");
    const offline = renderToStaticMarkup(<ProjectList list={{ items: [], loading: false, error: "Offline: reconnecting…" }} send={send} />);
    expect(offline).toContain('role="alert"');
    expect(offline).toContain("Offline: reconnecting…");
    expect(offline).toContain("No projects yet");
  });
});
