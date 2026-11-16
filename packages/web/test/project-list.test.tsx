import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectCard } from "@fm/editor";
import { Card, ProjectList } from "../src/panels/ProjectList";

const send = (): void => {};
const card = (id: string, name: string, more: Partial<ProjectCard> = {}): ProjectCard => ({ id, name, colour: "#fae3e7", status: "ready", picture: null, canTurn: false, view3d: null, layouts: null, ...more });

describe("ProjectList", () => {
  it("offers a create form and one button per project", () => {
    const html = renderToStaticMarkup(
      <ProjectList list={{ items: [card("p1", "Apartment"), card("p2", "Office")], loading: false, error: null, order: "name" }} send={send} />,
    );
    expect(html).toContain('placeholder="Project name"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Create<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p1"[^>]*>Apartment<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p2"[^>]*>Office<\/button>/);
    expect(html).not.toContain("Loading");
    expect(html.match(/<button[^>]*data-delete-id="p[12]"[^>]*>Delete<\/button>/g)).toHaveLength(2);
  });

  it("asks before deleting, in the row (spec: collaboration)", () => {
    const row = (confirming: boolean): string =>
      renderToStaticMarkup(
        <Card card={card("p1", "Apartment")} confirming={confirming} onAsk={send} onCancel={send} send={send} />,
      );
    expect(row(false)).not.toContain("Anyone who has it open");
    const asking = row(true);
    expect(asking).toContain("Delete “Apartment”? Anyone who has it open is sent back to the project list.");
    expect(asking).toMatch(/<button[^>]*data-confirm-delete="p1"[^>]*>Delete<\/button>/);
    expect(asking).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(asking).not.toContain("data-delete-id"); // one Delete at a time
  });

  it("shows a card's name, colour and plan image", () => {
    const picture = { primitives: [{ kind: "polygon" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: "#123456" }], frame: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, zoom: 100 } };
    const html = renderToStaticMarkup(<Card card={card("p1", "Flat", { picture })} confirming={false} onAsk={send} onCancel={send} send={send} />);
    expect(html).toContain("--fm-card-colour:#fae3e7");
    expect(html).toMatch(/<img[^>]*alt="Plan of Flat"/);
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain(encodeURIComponent("#123456"));
    expect(html).toMatch(/<button[^>]*data-project-id="p1"[^>]*>Flat<\/button>/);
  });

  it("marks a card that can turn, and has no 3D host until it's hovered", () => {
    const html = (more: Partial<ProjectCard>): string => renderToStaticMarkup(<Card card={card("p1", "Flat", more)} confirming={false} onAsk={send} onCancel={send} send={send} />);
    expect(html({ canTurn: true })).toContain("can-turn");
    expect(html({ canTurn: false })).not.toContain("can-turn");
    expect(html({ canTurn: true })).not.toContain("project-card-3d");
  });

  it("has a pill only with more than one layout, with dots up to five", () => {
    const html = (layouts: ProjectCard["layouts"]): string => renderToStaticMarkup(<Card card={card("p1", "Flat", { layouts })} confirming={false} onAsk={send} onCancel={send} send={send} />);
    expect(html(null)).not.toContain("project-card-pill");
    const two = html({ name: "Night", index: 1, count: 2 });
    expect(two).toMatch(/<button[^>]*project-card-pill[^>]*aria-label="Layout: Night\. Show the next layout"/);
    expect(two).toContain("○●");
    expect(html({ name: "Night", index: 1, count: 5 })).toContain("○●○○○");
    expect(html({ name: "Night", index: 1, count: 6 })).not.toContain("●");
  });

  it("can't turn without WebGL2: no grab cursor and no 3D host, even if the card could", () => {
    const html = renderToStaticMarkup(<Card card={card("p1", "Flat", { canTurn: true })} confirming={false} onAsk={send} onCancel={send} send={send} can3d={false} />);
    expect(html).not.toContain("can-turn");
    expect(html).not.toContain("project-card-3d");
  });

  it("reaches every control by keyboard: each is a button", () => {
    const html = renderToStaticMarkup(<Card card={card("p1", "Flat", { layouts: { name: "Day", index: 0, count: 2 } })} confirming={false} onAsk={send} onCancel={send} send={send} />);
    const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(["project-card-pill", "project-open", "project-delete"]);
    expect(html).not.toMatch(/<div[^>]*tabindex/);
  });

  it("says when nothing is drawn, and draws nothing while loading", () => {
    const line = (status: ProjectCard["status"]): string => renderToStaticMarkup(<Card card={card("p1", "Flat", { status })} confirming={false} onAsk={send} onCancel={send} send={send} />);
    expect(line("empty")).toContain("Nothing drawn yet");
    for (const status of ["unseen", "loading", "failed"] as const) {
      expect(line(status)).not.toContain("Nothing drawn yet");
      expect(line(status)).not.toContain("<img");
    }
  });

  it("offers the order, with the one in use pressed", () => {
    const html = renderToStaticMarkup(<ProjectList list={{ items: [card("p1", "Flat")], loading: false, error: null, order: "recent" }} send={send} />);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Name<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Recent<\/button>/);
  });

  it("shows loading, errors and an empty list", () => {
    const loading = renderToStaticMarkup(<ProjectList list={{ items: [], loading: true, error: null, order: "name" }} send={send} />);
    expect(loading).toContain("Loading");
    expect(loading).not.toContain("No projects yet");
    const offline = renderToStaticMarkup(<ProjectList list={{ items: [], loading: false, error: "Offline: reconnecting…", order: "name" }} send={send} />);
    expect(offline).toContain('role="alert"');
    expect(offline).toContain("Offline: reconnecting…");
    expect(offline).toContain("No projects yet");
  });
});
