import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary, FailurePage } from "../src/panels/ErrorBoundary";

// Web tests have no DOM (layout-states.38) and a server render doesn't run boundaries, so the boundary's two parts are
// asked directly: what an error does to its state, and what each state renders.
describe("ErrorBoundary (fixes AC-06)", () => {
  it("a thrown error becomes its state", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({ error: "boom" });
    expect(ErrorBoundary.getDerivedStateFromError("plain")).toEqual({ error: "plain" });
  });

  it("with no error it renders its children", () => {
    expect(renderToStaticMarkup(<ErrorBoundary><p>app</p></ErrorBoundary>)).toBe("<p>app</p>");
  });

  it("with an error it shows the message and a Reload button, not its children", () => {
    const boundary = new ErrorBoundary({ children: <p>app</p> });
    boundary.state = { error: "boom" };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Something went wrong");
    expect(html).toContain("boom");
    expect(html).toContain("Reload");
    expect(html).not.toContain("app");
  });
});

describe("FailurePage", () => {
  it("offers no Reload for a problem a reload can't fix", () => {
    const html = renderToStaticMarkup(<FailurePage title="Can't start" detail="Fix the address" reload={false} />);
    expect(html).toContain("Fix the address");
    expect(html).not.toContain("Reload");
  });
});
