import { describe, expect, it } from "vitest";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The Project section (sheet.04; AC-01, AC-06): with nothing selected, Properties lists the title block fields in
// PROJECT_FIELDS order; committing one sends setProjectField, which undoes like any edit.

const ids = ["subtitle", "address", "client", "number", "phase", "revision", "revisionDate", "author", "notes", "issueDate", "studioName", "studioAddress", "studioContact"];

describe("Project section (AC-06)", () => {
  it("Project and Ceiling stay the same controls while an edit awaits its answer: swapping one throws away the focus Tab gave it (sheetset.68)", () => {
    const r = FakeRemote.open(roomDoc());
    const before = { project: r.shell.view().projectFields ?? [], ceiling: r.shell.view().ceiling ?? [] };
    expect(before.project.length).toBeGreaterThan(0);
    r.shell.ui({ type: "setField", fieldId: "project.client", value: "Rossi" });
    const during = r.shell.view();
    expect(during.project?.canEdit).toBe(false); // the edit is out, unanswered
    const shape = (fields: readonly { id: string; readOnly: boolean; step?: number; options?: unknown }[]) => fields.map((f) => [f.id, f.readOnly, f.step, f.options !== undefined]);
    expect(shape(during.projectFields ?? [])).toEqual(shape(before.project));
    expect(shape(during.ceiling ?? [])).toEqual(shape(before.ceiling));
    expect((during.projectFields ?? []).find((f) => f.id === "project.client")?.value).toBe("Rossi");
  });

  it("lists the fields in order, section Project, notes multi-line, with the stored values", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "setProjectField", key: "client", value: "Rossi" }));
    const fields = shell.view().projectFields ?? [];
    expect(fields.map((f) => f.id)).toEqual(ids.map((k) => `project.${k}`));
    expect(fields.map((f) => f.label)).toEqual(["Subtitle", "Address", "Client", "Project number", "Phase", "Revision", "Revision date", "Author", "Notes", "Date of issue", "Studio name", "Studio address", "Studio contact"]);
    expect(fields.every((f) => f.section === "Project" && !f.readOnly && f.unit === null)).toBe(true);
    expect(fields.filter((f) => f.multiline).map((f) => f.id)).toEqual(["project.notes"]);
    expect(fields.find((f) => f.id === "project.client")?.value).toBe("Rossi");
    expect(fields.find((f) => f.id === "project.address")?.value).toBe("");
  });

  it("is null with a selection", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 3, y: 0 });
    expect(shell.view().properties.kind).toBe("wall");
    expect(shell.view().projectFields).toBeNull();
  });
});

describe("committing a field (AC-01)", () => {
  it("sets it, and undo and redo restore it", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "setField", fieldId: "project.client", value: "Rossi" });
    expect(shell.doc().projectFields).toEqual({ client: { id: "client", value: "Rossi" } });
    shell.ui({ type: "undo" });
    expect(shell.doc().projectFields).toEqual({});
    shell.ui({ type: "redo" });
    expect(shell.view().projectFields?.find((f) => f.id === "project.client")?.value).toBe("Rossi");
  });

  it("a refused value toasts the domain's reason and changes nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "setField", fieldId: "project.client", value: "x".repeat(81) });
    expect(shell.view().toast).toBe("Client is longer than 80 characters");
    expect(shell.doc().projectFields).toEqual({});
  });

  it("an unknown project field id sends nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "setField", fieldId: "project.colour", value: "red" });
    expect(shell.doc().projectFields).toEqual({});
    expect(shell.view().toast).toBeNull();
  });
});
