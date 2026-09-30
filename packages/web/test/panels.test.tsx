import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommandBar } from "../src/panels/CommandBar";
import { PropertiesPanel } from "../src/panels/PropertiesPanel";
import { StatusBar } from "../src/panels/StatusBar";
import { Toast } from "../src/panels/Toast";
import { Toolbar } from "../src/panels/Toolbar";
import { viewFixture } from "./fixtures";

const send = (): void => {};

function inputTag(html: string, fieldId: string): string {
  const match = new RegExp(`<input[^>]*data-field-id="${fieldId}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`no input for ${fieldId} in ${html}`);
  return match[0];
}

describe("Toolbar", () => {
  it("marks the active tool", () => {
    const html = renderToStaticMarkup(<Toolbar view={viewFixture({ activeTool: "wall" })} send={send} />);
    expect(html).toContain('data-tool="wall" aria-pressed="true"');
    expect(html).toContain('data-tool="select" aria-pressed="false"');
    expect(html).toContain('data-tool="zone" aria-pressed="false"');
  });

  it("disables undo and redo from the ViewModel", () => {
    const html = renderToStaticMarkup(<Toolbar view={viewFixture({ canUndo: false, canRedo: true })} send={send} />);
    expect(html).toMatch(/<button[^>]*data-action="undo"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*data-action="redo"[^>]*disabled=""/);
  });
});

describe("CommandBar", () => {
  it("shows the prompt, the typed value and its unit", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "Next point or length", value: "3.2", unit: "m" } })} />);
    expect(html).toContain("Next point or length");
    expect(html).toContain('data-testid="command-value">3.2<');
    expect(html).toContain(">m<");
  });

  it("hides the unit while nothing is typed", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "First point", value: "", unit: "m" } })} />);
    expect(html).not.toContain(">m<");
  });
});

describe("PropertiesPanel", () => {
  it("says when nothing is selected", () => {
    expect(renderToStaticMarkup(<PropertiesPanel view={viewFixture()} send={send} />)).toContain("Nothing selected");
  });

  it("renders read-only wall fields with their field IDs", () => {
    const view = viewFixture({
      properties: {
        kind: "wall",
        fields: [
          { id: "length", label: "Length", value: "6.00", unit: "m", readOnly: true },
          { id: "thickness", label: "Thickness", value: "0.20", unit: "m", readOnly: true },
        ],
      },
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={send} />);
    expect(html).toContain(">Wall<");
    const length = inputTag(html, "length");
    expect(length).toContain('value="6.00"');
    expect(length).toMatch(/readonly=""/i); // React 19.3 prints `readOnly`; HTML attribute names ignore case
    expect(inputTag(html, "thickness")).toContain('value="0.20"');
  });

  it("renders an editable zone name, disabled when editing is blocked", () => {
    const fields = [
      { id: "name", label: "Name", value: "Kitchen", unit: null, readOnly: false },
      { id: "area", label: "Area", value: "10.64 m²", unit: null, readOnly: true },
    ];
    const editable = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "zone", fields } })} send={send} />);
    const name = inputTag(editable, "name");
    expect(name).toContain('value="Kitchen"');
    expect(name).not.toMatch(/readonly/i);
    expect(name).not.toContain("disabled");

    const blocked = renderToStaticMarkup(
      <PropertiesPanel
        view={viewFixture({
          properties: { kind: "zone", fields },
          project: { name: "Apartment", status: "waiting for server", dirty: false, canEdit: false },
        })}
        send={send}
      />,
    );
    expect(inputTag(blocked, "name")).toContain('disabled=""');
  });
});

describe("StatusBar", () => {
  it("shows the project, its status and collaborators", () => {
    const html = renderToStaticMarkup(
      <StatusBar
        view={viewFixture({
          project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
          presence: [{ clientId: "b", name: "Bob", color: "#e67e22", at: null }],
        })}
      />,
    );
    expect(html).toContain('data-testid="project-name">Apartment<');
    expect(html).toContain('data-testid="project-status" data-status="saved">saved<');
    expect(html).toMatch(/data-testid="collaborators"[^>]*>.*Bob/);
  });

  it("renders an empty collaborators list and no status without a project", () => {
    const html = renderToStaticMarkup(<StatusBar view={viewFixture({ project: null })} />);
    expect(html).toContain("No drawing open");
    expect(html).not.toContain("project-status");
    expect(html).toContain('data-testid="collaborators"');
  });
});

describe("Toast", () => {
  it("renders nothing without a toast", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture()} />)).toBe("");
  });

  it("renders the toast text as a status message", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture({ toast: "Wall too short" })} />)).toBe(
      '<div class="toast fm-toast" role="status">Wall too short</div>',
    );
  });
});
