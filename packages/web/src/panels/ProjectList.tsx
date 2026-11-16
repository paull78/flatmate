import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type RefObject } from "react";
import type { CardLayouts, CardOrder, CardPicture, ProjectCard, UiAction, View3dFrame, ViewModel } from "@fm/editor";
import { toSvg } from "@fm/export";
import { hoversIn3d, moved, press, release, type CardGesture } from "./card-gesture";
import { browserStorage, readCardOrder, writeCardOrder } from "./card-order";

const ORDERS: readonly (readonly [CardOrder, string])[] = [["name", "Name"], ["recent", "Recent"]];

type Card3d = { render(frame: View3dFrame | null): void; dispose(): void };
/** The shell's 3D renderer on `host`, transparent so a card's grid shows, or null where WebGL2 can't start. */
export type MakeCard3d = (host: HTMLElement, onLost: () => void) => Card3d | null;

type Props = { list: NonNullable<ViewModel["projectList"]>; send(action: UiAction): void; makeCard3d?: MakeCard3d };

/** The project list (docs/try-it.md step 1, spec: collaboration), as cards (cycle cards). It renders the ViewModel and sends ui events only. */
export function ProjectList({ list, send, makeCard3d }: Props) {
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // the project whose delete is being asked
  const frame = list.items.find((c) => c.view3d !== null)?.view3d ?? null;
  const { attach, available } = useShared3d(frame, makeCard3d);

  useEffect(() => {
    const saved = readCardOrder(browserStorage);
    if (saved !== list.order) send({ type: "setCardOrder", order: saved });
    // Only when the list opens: from then on the control below sets both.
  }, []);
  const setOrder = (order: CardOrder): void => {
    writeCardOrder(browserStorage, order);
    send({ type: "setCardOrder", order });
  };

  const create = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    send({ type: "createProject", name: trimmed });
    setName("");
  };

  return (
    <section className="project-list fm-projectlist" data-testid="project-list" data-own-keys="">
      <div className="project-list-head">
        <h1>Projects</h1>
        <div className="fm-seg project-list-order" role="group" aria-label="Order">
          {ORDERS.map(([order, label]) => (
            <button key={order} type="button" aria-pressed={list.order === order} onClick={() => setOrder(order)}>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={create}>
          <input aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit">Create</button>
        </form>
      </div>
      {list.loading ? <p className="muted">Loading…</p> : null}
      {list.error !== null ? (
        <p className="error" role="alert">
          {list.error}
        </p>
      ) : null}
      {list.items.length === 0 && !list.loading ? <p className="muted">No projects yet</p> : null}
      <ul className="project-cards">
        {list.items.map((card) => (
          <Card
            key={card.id}
            card={card}
            confirming={confirming === card.id}
            onAsk={() => setConfirming(card.id)}
            onCancel={() => setConfirming(null)}
            send={send}
            attach3d={attach}
            can3d={available}
          />
        ))}
      </ul>
    </section>
  );
}

type CardProps = {
  card: ProjectCard;
  confirming: boolean;
  onAsk(): void;
  onCancel(): void;
  send(action: UiAction): void;
  attach3d?: (host: HTMLElement | null) => void; // where the shared 3D view goes while this card is hovered
  can3d?: boolean; // false: this browser can't draw it, so the card stays on its plan
};

/** One project: a click opens it, a hover shows it in 3D and a drag turns it; Delete asks in place (no browser dialog, spec: collaboration). */
export function Card({ card, confirming, onAsk, onCancel, send, attach3d, can3d = true }: CardProps) {
  const item = useRef<HTMLLIElement>(null);
  useOnSeen(item, card.status === "unseen", () => send({ type: "cardSeen", id: card.id }));
  const open = (): void => send({ type: "openProject", id: card.id });
  const gesture = useRef<CardGesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const canTurn = card.canTurn && can3d;
  const hover = (e: PointerEvent): void => {
    if (hoversIn3d({ pointerType: e.pointerType, canTurn, showing3d: card.view3d !== null, pressed: gesture.current !== null })) send({ type: "cardHover", id: card.id });
  };
  const leave = (): void => {
    if (gesture.current === null) send({ type: "cardHover", id: null });
  };
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    gesture.current = press(e.clientX, e.clientY);
    if (e.pointerType === "mouse") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    hover(e);
    if (e.pointerType !== "mouse" || !canTurn) {
      gesture.current = moved(gesture.current, e.clientX, e.clientY).gesture;
      return;
    }
    const { gesture: next, delta } = moved(gesture.current, e.clientX, e.clientY);
    gesture.current = next;
    if (next?.dragging === true) setDragging(true);
    if (delta !== null) send({ type: "cardOrbit", ...delta, width: e.currentTarget.getBoundingClientRect().width });
  };
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    const ended = release(gesture.current);
    gesture.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (ended === "click") open();
  };
  const cancel = (): void => {
    gesture.current = null;
    setDragging(false);
  };
  const shows3d = card.view3d !== null && can3d;
  const classes = `project-card-ground${canTurn ? " can-turn" : ""}${shows3d ? " shows-3d" : ""}${dragging ? " dragging" : ""}`;
  return (
    <li ref={item} className="project-card">
      <div
        className={classes}
        style={{ "--fm-card-colour": card.colour }}
        data-card-ground={card.id}
        onPointerEnter={hover}
        onPointerLeave={leave}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
      >
        {card.picture !== null ? <PlanImage picture={card.picture} name={card.name} /> : null}
        {card.status === "empty" ? <span className="project-card-empty">Nothing drawn yet</span> : null}
        {shows3d && attach3d ? <div className="project-card-3d" ref={attach3d} /> : null}
        {card.layouts !== null ? <LayoutPill layouts={card.layouts} onNext={() => send({ type: "cardNextLayout", id: card.id })} /> : null}
      </div>
      <button type="button" className="project-open" data-project-id={card.id} onClick={open}>
        {card.name}
      </button>
      {confirming ? (
        <div className="project-card-ask">
          <p>Delete “{card.name}”? Anyone who has it open is sent back to the project list.</p>
          <div className="project-row-actions">
            <button
              type="button"
              className="danger"
              data-confirm-delete={card.id}
              onClick={() => {
                onCancel();
                send({ type: "deleteProject", id: card.id });
              }}
            >
              Delete
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="project-delete" data-delete-id={card.id} onClick={onAsk}>
          Delete
        </button>
      )}
    </li>
  );
}

/**
 * The list's one 3D view (cards.02): a browser allows only a few live WebGL contexts, so one canvas moves to the hovered
 * card. It's made on the first hover; `available` goes false where WebGL2 can't start or its context is lost.
 */
function useShared3d(frame: View3dFrame | null, make: MakeCard3d | undefined): { attach: (place: HTMLElement | null) => void; available: boolean } {
  const kit = useRef<{ host: HTMLDivElement; renderer: Card3d } | null>(null);
  const [available, setAvailable] = useState(make !== undefined);
  const ensure = useCallback((): { host: HTMLDivElement; renderer: Card3d } | null => {
    if (kit.current !== null) return kit.current;
    const host = document.createElement("div");
    host.className = "project-card-3d-host";
    const renderer = make?.(host, () => setAvailable(false)) ?? null;
    if (renderer === null) {
      setAvailable(false);
      return null;
    }
    kit.current = { host, renderer };
    return kit.current;
  }, [make]);
  const attach = useCallback((place: HTMLElement | null) => {
    if (place !== null) place.replaceChildren(ensure()?.host ?? "");
  }, [ensure]);
  useEffect(() => {
    if (frame !== null) ensure()?.renderer.render(frame);
  }, [frame, ensure]);
  useEffect(() => () => {
    kit.current?.renderer.dispose();
    kit.current = null;
  }, []);
  return { attach, available };
}

/** No dots past this many layouts: they'd crowd the name. */
const MAX_DOTS = 5;

/** The layout shown; a click moves to the next. Its press stays its own, so it neither opens the project nor turns the home. */
function LayoutPill({ layouts, onNext }: { layouts: CardLayouts; onNext(): void }) {
  const dots = Array.from({ length: layouts.count }, (_, i) => (i === layouts.index ? "●" : "○")).join("");
  return (
    <button
      type="button"
      className="project-card-pill"
      aria-label={`Layout: ${layouts.name}. Show the next layout`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onNext}
    >
      <span className="project-card-pill-name">{layouts.name}</span>
      {layouts.count <= MAX_DOTS ? <span className="project-card-pill-dots" aria-hidden="true">{dots}</span> : null}
    </button>
  );
}

function PlanImage({ picture, name }: { picture: CardPicture; name: string }) {
  const src = useMemo(() => `data:image/svg+xml,${encodeURIComponent(toSvg(picture.primitives, { ...picture.frame, background: null }))}`, [picture]);
  return <img className="project-card-plan" src={src} alt={`Plan of ${name}`} draggable={false} />;
}

/** Calls `onSeen` once `ref` scrolls into view, or at once where the browser can't say (cards.02). */
function useOnSeen(ref: RefObject<Element | null>, active: boolean, onSeen: () => void): void {
  const latest = useRef(onSeen);
  latest.current = onSeen;
  useEffect(() => {
    if (!active) return;
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") {
      latest.current();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, ref]);
}
