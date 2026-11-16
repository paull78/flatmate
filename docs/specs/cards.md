# Cards

The project list shows each project as a card: a pale ground with the project's plan on it and its name below. A mouse hover shows the home in 3D, a drag turns it, a click opens the project. This document covers the card, its plan and 3D view, the layout pill, the order, Delete, the keyboard and how the list is built.

```
at rest          hover (mouse)           drag                  click
+-----------+    +-----------+           +-----------+
| [Day o]   |    | [Day o]   |  press,   |  turns,   |         opens the
|  coloured |    |  3D home, |  move     |  tilts    |         project
|  plan     |    |  still    |  4 px+    |           |
+-----------+    +-----------+           +-----------+
 Name
```

## The card

`ProjectList` and `Card` in `packages/web/src/panels/ProjectList.tsx` render the view model's `ProjectCard`s (built by `projectCards` in `packages/editor/src/view/cards.ts`) and send UI events only.

- **Colour.** `cardColour(id)` picks one of the 14 `CARD_COLOURS` by an FNV-1a hash of the project id, so every client and every load agrees: `#fae3e7`, `#fce3df`, `#fae5d6`, `#f0eacc`, `#e5eed4`, `#dfefde`, `#d7f0e6`, `#d5f0ef`, `#d8eef7`, `#dcecfb`, `#e3e9fd`, `#ebe6fa`, `#f4e3f3`, `#f9e2ec`. All share one lightness and none is near a wood floor. Two projects can share a colour; it says nothing about the project.
- **Grid.** A faint drafting grid in `#4a453a` lies on the ground, darker lines at about 9 % opacity and lighter ones at about 4 % (`packages/web/src/styles.css`).
- **Name.** Below the ground, as a button that opens the project.
- **Status.** `unseen` and `loading` (no drawing yet), `failed` (the drawing doesn't read), `empty` and `ready`. A card that is loading or failed shows its bare ground and name, with no error line, and still opens. A drawing with no walls, no decks and no placements is `empty` and reads "Nothing drawn yet".

## The plan

At rest the card shows `cardPicture(doc, layout)`: the plan of the chosen layout (the first in `orderedStates` by default) at floor level (`floorView`), with no tags, dimensions, deck labels, marks or roof. Its long side is 1100 drawing units; it is kept per document and layout, as the view model rebuilds on every event. The panel draws it with `toSvg` into an `<img>` with no background.

The plan has its own style, `CARD_STYLE` in `packages/editor/src/view/card-look.ts`: the presentation style with lines wide enough for a card, and opening details never drawn. Each piece is filled by `cardPieceColour(kind)`: the material seen most from above in the kind's own 3D parts at its default size, found on a 16 × 16 grid over the piece where each cell takes its highest part. Wood is deepened to `#b98f63` so a table stands out on a wood floor; laminate is `#ecebe6`, plain `#e0e0de`, the other materials the 3D view's tops. A rug keeps its own fill. The colour is worked out once per kind. The canvas, the exports and `look` keep their own styles.

## Hover, drag and click

A hover shows 3D only when `hoversIn3d` in `packages/web/src/panels/card-gesture.ts` allows it: a mouse pointer, a card that can turn (a chosen layout and a shell to frame, `shellBounds`), a browser whose shared 3D view started, and no press in progress. Touch and pens see the plan only, and a tap opens.

- **Hover.** The 3D home fades in (0.18 s) at the default angles, yaw 225° and tilt 35° (`DEFAULT_ANGLES`), standing still. Moving the mouse doesn't turn it. The card's class `can-turn` sets the grab cursor, `dragging` the grabbing one.
- **Drag.** `press`, `moved` and `release` decide click or drag. A movement of `CLICK_SLOP_PX` (4 px) or more from the press makes a drag, and it stays one even if the mouse comes back. `withCardOrbit` in `packages/editor/src/card-state.ts` turns it as the orbit does: dragging right lowers the yaw, one card width is a full turn; up and down change the tilt at `ORBIT_DEG_PER_PX` (0.4° per pixel), held to 10 to 90°. The card captures the mouse pointer, so a drag carries on outside it.
- **Release and leave.** Releasing keeps the angle while the mouse stays on the card. Leaving goes back to the plan, and the next hover starts at the default angles (`withCardHover`).
- **Click.** A press and release under the slop opens the project, anywhere on the ground. The name opens it too.

The 3D picture is `cardFrame3d` in `packages/editor/src/view3d-state.ts`: the chosen layout's scene with finishes, without the surroundings (a house on wheels keeps its trailer) and without the roof, framed from the corner. The panel draws it 20 % larger than the card's ground (CSS inset −10 %), so the ground clips what passes its edge.

## The layout pill

A project with more than one layout shows a pill on its card: the shown layout's name and, up to five layouts, one dot each (● the shown one, ○ the others). With more than five there are no dots. A click runs `cardNextLayout`: the next layout, wrapping round. The pill keeps its own press, so it never opens the project or turns the home.

The plan changes at once. On the hovered card the 3D view glides from the old layout to the new one over the editor's flip, `FLIP_MS` (500 ms), driven by `onCardFrame`, and keeps its angles. The choice lasts until the list opens again.

## The order, Delete and the keyboard

- **Order.** A two-button control beside the heading, `Name` and `Recent` (`CardOrder`: `name` or `recent`). Name, the default, is the server's order by name (`byNameThenId`). Recent sorts by `editedAt`, last edited first; a project with no date counts as newest; ties keep the name order. The choice is this browser's own, stored in `localStorage` under `fm.cardOrder` by `packages/web/src/panels/card-order.ts`; storage that is blocked or broken means Name.
- **Last edit.** `editedAt` is the project file's modification time, read when the list is asked for (`list` in `packages/server/src/adapters/json-file-repository.ts`). Copying or restoring a data folder changes these dates.
- **Delete.** A button at the card's top right, shown on hover or keyboard focus, and always where the screen has no hover. It asks in place: "Delete “name”? Anyone who has it open is sent back to the project list.", with Delete and Cancel.
- **Keyboard.** The list's section carries `data-own-keys`, so the window's key handler in `packages/web/src/adapters/input.ts` leaves every key to it, and Enter and Space work its buttons. The keyboard reaches each card's name, pill and Delete.

## How it's built

The browser draws everything; the server only hands over the drawing.

```
list opens ── list ──> server
card comes into view (IntersectionObserver)
  editor: cardSeen → read effect ── readProject ──> server: the stored drawing,
                                                    no underlays, no logos, no session
  editor <── projectDrawing ── withCardDrawing (latest request only)
  view model: projectCards → colour, plan picture, layouts, 3D frame for the hovered card
web: plan via toSvg into an <img>; one shared 3D renderer moved to the hovered card
```

- `cardSeen` asks for a drawing once per list opening, only while no document is open. `NO_CARD_VIEWS` empties the drawings, the hover, the chosen layouts and the glide when the list opens and when the connection returns (`packages/editor/src/session.ts`), so edits show next time. There are no live updates while the list is open.
- The server's `read` in `packages/server/src/app/server-app.ts` runs in the project's queue, after a save in progress, joins no session, and sends the document with `underlays` and `logos` emptied. Nothing new is stored in a project.
- The editor owns the colours, the plan style, the angles and rates, the hovered card, the chosen layouts, the order and the fetches (`view/cards.ts`, `view/card-look.ts`, `card-state.ts`). The panel owns the press-or-drag rule (`card-gesture.ts`).
- A browser allows only a few live WebGL contexts, so the list has one 3D view (`useShared3d`), made on the first hover through the `makeCard3d` prop from `packages/web/src/main.tsx` on a transparent background, and moved to the hovered card. Where WebGL2 can't start or its context is lost, every card stays on its plan.

## Limits

- A card starts on the first layout at floor level. There is no choosing a cover, a camera angle or a colour.
- The list has no search and no folders.
- A card's drawing is fetched once per list opening; changes made meanwhile show the next time the list opens.
