import { cloneElement, isValidElement, type ReactElement } from "react";

// Web tests run in node without a DOM (layout-states.38): panels are called as functions and their element trees
// searched for props. This works for hook-free panels; child components (DraftInput) are not rendered.

/** The props of every element in the tree (without rendering it) that matches. */
export function findAll(node: unknown, match: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const props: unknown = node.props;
  if (typeof props !== "object" || props === null) return [];
  const record: Record<string, unknown> = { ...props };
  const here = match(record) ? [record] : [];
  return [...here, ...("children" in record ? findAll(record.children, match) : [])];
}

/** The props of the first element carrying `data-testid`, or null. */
export function findByTestId(node: unknown, testId: string): Record<string, unknown> | null {
  return findAll(node, (p) => p["data-testid"] === testId)[0] ?? null;
}

/** Calls a handler prop, failing the test when it is missing. */
export function call(props: Record<string, unknown> | null | undefined, name: string, ...args: unknown[]): void {
  const fn = props?.[name];
  if (typeof fn !== "function") throw new Error(`no ${name} handler`);
  fn(...args);
}

/**
 * The tree with its plain function components called in place, so `findAll` sees inside them. Those named in `withHooks`
 * stay as elements: they'd need a renderer.
 */
export function expanded(node: unknown, withHooks: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((child) => expanded(child, withHooks));
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  const type: unknown = node.type;
  if (typeof type === "function" && !withHooks.includes(type.name)) return expanded(type(node.props), withHooks);
  const element: ReactElement<Record<string, unknown>> = node;
  return "children" in element.props ? cloneElement(element, { children: expanded(element.props["children"], withHooks) }) : element;
}

/** A mouse down on a button, with nothing focused, for a handler that asks what has the focus (`keepFocus`). */
export function mouseDown(preventDefault: () => unknown): Record<string, unknown> {
  return { preventDefault, currentTarget: { ownerDocument: { activeElement: null } } };
}
