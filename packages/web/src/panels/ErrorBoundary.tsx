import { Component, type ReactNode } from "react";

/** A whole-page message for what stops the app: one line, its detail, and Reload when a reload can help. */
export function FailurePage({ title, detail, reload }: { title: string; detail: string; reload: boolean }) {
  return (
    <main className="failure-page" role="alert">
      <h1>{title}</h1>
      <p>{detail}</p>
      {reload ? (
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      ) : null}
    </main>
  );
}

type Props = { children: ReactNode };
type State = { error: string | null };

/** The panels run core code while rendering (a sheet's pages, a card's SVG): a throw there says so, not a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return <FailurePage title="Something went wrong" detail={this.state.error} reload />;
  }
}
