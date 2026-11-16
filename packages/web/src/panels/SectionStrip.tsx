import { useRef, type RefObject } from "react";
import type { SectionStrip as Strip, UiAction, ViewModel } from "@fm/editor";
import { FrameButton, FrameHead, FrameSeparator, useElementSize } from "./Frame";
import { keepFocus } from "./keep-focus";
import { PageCanvas, type DrawPage } from "./SheetPage";

type Props = { strip: Strip; frames: ViewModel["frames"]; drawPage: DrawPage; send(action: UiAction): void; onSwap(): void };

/**
 * The section's frame under the plan (spec "The strip"): the title bar over a page as large as the frame. Canvas2D
 * whatever the plan's renderer, as the GPU layers don't keep draw order. The page's identity gives its redraws.
 */
export function SectionStrip(props: Props) {
  const body = useRef<HTMLDivElement>(null);
  return <SectionFrame {...props} body={body} size={useElementSize(body)} />;
}

export function SectionFrame({ strip, frames, drawPage, send, onSwap, body, size }: Props & { body: RefObject<HTMLDivElement | null>; size: { w: number; h: number } | null }) {
  const larger = () => send({ type: "toggleLargerDock" });
  return (
    <section className="frame section-frame" data-testid="section-strip" style={{ order: frames.sectionFirst ? 0 : 2, flexGrow: frames.side ? frames.sectionShare : 1 }}>
      <FrameHead label={strip.label} layout={strip.layout} onDoubleClick={larger}>
        {strip.letters.length > 1 ? (
          <span className="frame-letters" role="group" aria-label="Sections">
            {strip.letters.map(({ section, label }) => (
              <button key={section} type="button" data-section={section} aria-pressed={section === strip.section} onMouseDown={keepFocus} onClick={() => send({ type: "showSection", section })}>
                {label}
              </button>
            ))}
          </span>
        ) : null}
        <FrameSeparator />
        {frames.side ? <FrameButton icon="swap" action="swap-frames" title="Swap the frames" onClick={onSwap} /> : null}
        <FrameButton icon={frames.larger ? "smaller" : "larger"} action="larger-frames" title={frames.larger ? "Back to the usual size" : "Larger"} onClick={larger} />
        <FrameButton icon="close" action="close-section" testId="section-strip-close" title="Close the section" onClick={() => send({ type: "closeSection" })} />
      </FrameHead>
      <div className="frame-body" ref={body}>
        {size !== null ? <PageCanvas page={strip.page(size)} css={size} drawPage={drawPage} testId="section-strip-canvas" /> : null}
      </div>
    </section>
  );
}
