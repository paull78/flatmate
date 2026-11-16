# Typed input

How a person types a number, how the app reads it, and how it shows a number. What a typed length does to a wall while drawing or moving it: [wall-editing.md](wall-editing.md).

## Where a value is typed

Every typed number goes through `readValue` in `packages/editor/src/typed-value.ts`, except the sheets view's north angle, a browser number field ([export.md](export.md)). A canvas value field's text is held by the editor and shown in the hint line; a panel text field is read once when it commits.

| Field | Kind | Prompt or place | Owner of what the value does |
|---|---|---|---|
| Wall tool length | canvas | "Next point or length" | [wall-editing.md](wall-editing.md) |
| Distance while moving walls | canvas | "Distance to move" | [wall-editing.md](wall-editing.md) |
| Split distance | canvas | "Click the wall to split it, or type the distance from the face's start" | [wall-editing.md](wall-editing.md) |
| A selected wall's length plate or a piece between openings | canvas | the plate's own prompt | [wall-editing.md](wall-editing.md), [openings.md](openings.md) |
| A deck hole's gap | canvas | "Distance to the deck's edge" | [heights-decks.md](heights-decks.md) |
| Scale tool distance | canvas | "Real distance between the points" | [underlay.md](underlay.md) |
| Properties number fields | panel | Properties | the entity's document |
| Wall thickness, column width and depth | panel | floating bar | [walls-rooms.md](walls-rooms.md) |
| Width, depth and height of the armed kind | panel | hint line | [furniture.md](furniture.md) |

What is shown stays metric everywhere. Claude's tools take numbers in metres, never typed text ([mcp.md](mcp.md)).

## What a value can be

```
 value   = term (("+" | "-") term)*
 term    = factor (("*" | "/") factor)*
 factor  = "-"? (number | "(" value ")")
 number  = digits unit?  |  feet-and-inches
 digits  = 2.80, 2,80, 2. or .5
 unit    = m | cm | mm | ft | in | ' | "     (fields in metres only)
```

- No unit means metres. A unit is only a scale, in metres per unit, with no checking of dimensions: `1m/2cm` is 50. Unit letters ignore case.
- `−` reads as `-`, `×` as `*`, `′` as `'` and `″` as `"`.
- Spaces between tokens are ignored; a tab is unreadable. Two numbers side by side are unreadable, so `3m 60cm` and `3m60cm` are typed `3m+60cm`.
- The comma is only a decimal mark: `1,000` reads 1 m.
- Unreadable: an empty text, division by zero, two decimal marks (`2.8.1`), a leading `+`, `--1`, `2(3)`, `1e3`, `0x10`, `Infinity`, an unknown unit (`2km`), and any text over 200 characters (`MAX_TEXT`).
- A field without units (degrees, percent) refuses every unit, so `45cm` in an Angle is unreadable.
- The parser takes only float noise off a result, rounding to a billionth (`NOISE`), and turns `-0` into `0`. Stored values are whole millimetres ([domain.md](domain.md)).
- Each field keeps its own refusal of a readable value (a length of 0, a negative gap, a size out of range).

| Unit | Metres per unit |
|---|---|
| `m` | 1 |
| `cm` | 0.01 |
| `mm` | 0.001 |
| `ft`, `'` | 0.3048 |
| `in`, `"` | 0.0254 |

### Feet and inches

A length in feet and inches is one number to the grammar: feet, then optionally a `-` and inches, marked, worded or bare, spaces aside. It reads into metres wherever a value is in metres, so a plan given in feet is typed as written.

```
 marks        words            metres
 8'           8ft              2.4384
 8'6"         8ft 6in          2.5908
 8' 6"        8 ft 6 in        2.5908
 102"         102in            2.5908
 8.5'         8.5ft            2.5908
 8'6                           2.5908   a bare number right after feet is inches
 8'-6"        8ft-6in          2.5908   the drafting dash
```

- After feet, a bare number following the dash is inches: `8'-6` and `8' - 6` read 2.5908, while `2 - 6` is -4.
- The dash separates only before inches. Before any other value it subtracts: `8'-0.5m` is 1.9384, `8'-1'` is 2.1336. Inches are taken from feet with brackets: `8'-(6")`.
- Feet and inches mix with metres anywhere: `8'+0.5m`, `3m-6"`, `(8'6")/2`. A leading `-` negates the whole length.
- Any other two numbers side by side stay unreadable: `8' 6m`, `6" 8'`, `8'6"2`, `8''`.

## Keys in a canvas value field

The editor holds a canvas field's text. `valueChar(value, key)` says what a key adds, and `editedValue` applies it or trims one character on `Backspace`. A key the field doesn't take returns null and goes on.

| Key | Taken |
|---|---|
| `0`-`9` `.` `,` `+` `-` `*` `/` | always |
| `Space` | only in a started value; on an empty one it goes on |
| `c`, `f`, `i`, `'`, `"` | only after a digit or decimal mark, spaces aside; letters are kept lower case |
| `m` | after a digit or decimal mark, or after `c` or `m` that follow one (`cm`, `mm`) |
| `t`, `n` | only after an `f` or `i` that follows a number |
| `(` `)` | never: brackets are typed in panel fields only |

So `M` and `C` with nothing typed, or after an operator, still pick their tools. Only `Enter` commits; `Esc` belongs to each tool.

**Key order** (`onKey` in `packages/editor/src/keys.ts`): the active value field first, then the tool shortcuts, then the global shortcuts. `Ctrl` and `Cmd` chords skip the field while a value is typed or walls are dragged. While a value is typed (`typingValue`; during a walls drag only once a value key is typed), `Page Up`, `Page Down` and the level strip are ignored ([levels.md](levels.md)). While the Wall tool waits for the server, value keys are ignored, never queued.

**Physical keys** (`normalizeKey` in `packages/web/src/adapters/input.ts`). The web shell turns a key into the text the field reads:

- a `Digit` or `Numpad` code is its digit, with or without `Shift`, so a length typed with `Shift` held for an orthogonal wall stays digits;
- `Period` and `NumpadDecimal` are `.`; the `Comma` key is `,` with any modifier;
- `_` reads as `-`, and `?` on the `Minus` code (an Italian `Shift`+`'`) reads as `'`.

As a result the field takes `+ - , c m` on every layout, and `*` and `/` where they don't need a digit key: an Italian keyboard gets `/` only from the numpad, a US one `*` only from the numpad. An Italian `Shift`+`+` gives `*`, which the hint's result shows. Where `"` is `Shift` + a digit, the canvas takes inches as `8'6`, `102in` or `8ft 6in`; panel fields take `"` on every keyboard.

## The hint line

`typedLine(typed)` gives the hint line's value and unit for a canvas field. The prompt is the field's (table above).

```
 typed       shown
 2.80        2.80 m               a plain number: as typed
 2,80        2,80 m
 2.80-       2.80-                unreadable: the text only, no unit
 2.80-0.6    2.80-0.6 = 2.20 m
 280cm       280cm = 2.80 m
 10/3        10/3 = 3.333 m       two decimals, three when the millimetre needs them
 8'6"        8'6" = 2.591 m
```

The result shows two decimals when it is a whole centimetre, else three. The unit shows only when the value isn't empty; while the Wall tool waits for the server the hint reads "Waiting for server" with no value. A length plate on the plan shows the text as typed; clicking the plate being edited keeps it, another plate starts empty.

`Enter` on an unreadable value toasts `Can't read <text>` (`cantRead`) and leaves the field open with its text. `Enter` on an empty field: the Wall tool ends the chain, a split splits at the tick, a plate or a gap edit ends with no change. A plate's total of 0 or a negative gap toasts `Type a length in metres`.

## Properties and the floating bar

**Panel text fields.** Every number field of Properties and the floating bar is a `DraftInput` (`packages/web/src/panels/DraftInput.tsx`): a local draft that commits a changed value on blur, and `Enter` blurs. `Esc` restores the value without committing. After a commit the draft returns to the editor's value, so an accepted edit shows the new value and a refused one the old. There is no live result.

**Properties** (`setField` in `packages/editor/src/properties/edit.ts`). A number field (a field with a `step`) is read once, by `readField`, with its unit: a field in `m` takes units, any other unit takes sums only. The number goes to the entity's command as plain text.

| Typed | Result |
|---|---|
| unreadable | toast `Can't read <text>`, the field returns to its old value |
| blank | toast `Enter a number`, unless the field gives a blank a meaning (a section's Depth) |
| a piece's Angle that isn't whole | toast `Type a whole number of degrees` |
| out of range | the domain refuses it with its own toast |

Each number field has small up and down steppers. A click adds or takes one step (`steppedValue` in `packages/editor/src/view/view-model.ts`), formatted to the step's decimals and committed like a typed value. Steps: 0.01 m for sizes and lengths; 0.05 m for thicknesses, the ceiling's heights and overhang, and a finish band's height; 0.005 m for a floor motif's size; 1 for degrees and percent, which formats to whole numbers. Fields are declared with `numberField` in `packages/editor/src/properties/fields.ts`.

**The floating bar.** The Wall tool's Thickness and the Column tool's width and depth are plain text fields with no steppers, read as metres. An unreadable value toasts `Can't read <text>` and keeps the setting; a readable one outside the limits toasts the limits and keeps it (`setWallThickness` in `properties/edit.ts`, `setColumnSize` in `packages/editor/src/tools/column-tool.ts`).

**The armed size** in the hint line reads the same way, but an unreadable or out-of-range value stays in its field marked invalid, with no toast ([furniture.md](furniture.md)).

## The hidden value input

While a canvas value field is open (the view model's `typing`), the hint line holds a visually hidden 1 px text input marked `data-editor-keys` (`packages/web/src/panels/CommandBar.tsx`). It holds the focus so browser keyboard extensions leave the digits alone. The editor still holds the text; the input stays empty.

- **Focus.** The input takes the focus when it mounts only if nothing has it (`focusOnMount`), so a Thickness field being typed in keeps it. Every canvas press focuses it (`focusOnPress`). A panel field that lets the focus go with no press in progress (a `DraftInput` blurs on `Enter`) hands it back. Focusing never scrolls the hint line.
- **Keys.** Its keys take the same path as every key (`routeKey`). Printable keys, `Backspace` and `Delete` without `Ctrl`, `Cmd` or `Alt` have their default prevented, and `beforeinput` is cancelled (`refuseInput`), so nothing fills it by itself: no IME, no pasted or dropped text.
- **A lost Escape.** A keyboard extension in an insert mode may swallow `Esc` and blur the field. The input losing the focus with no press in progress while the window keeps it counts as `Esc` (`focusLoss`), and so does an `Esc` keyup whose keydown never arrived (`lostEscape`).

## Remote changes while typing

The Wall tool's chain ends with its own toast only on a topology change or when its anchor joint is gone; any other remote change refreshes it and keeps the typed length ([wall-editing.md](wall-editing.md)). A plate, gap or split field is cancelled with "Drawing changed remotely" when a change touches what it reads (`packages/editor/src/gestures.ts`), a piece's plate also by any opening deleted or by the server refusing the person's own change, and a snapshot or a lost connection cancels them all ([collaboration.md](collaboration.md)).

## Showing numbers

One module, `packages/domain/src/format.ts`, shows every metre, square metre and limit in the plan, Properties, tags, toasts, exports and Claude's text.

| Function | Gives |
|---|---|
| `shown(v, digits = 2)` | `v` with `digits` decimals, halves away from zero; never `-0.00` |
| `shownCm(v)` | the whole centimetre a metre value shows as, to compare sizes as the fields show them |
| `toMm(v)` | metres to the whole millimetre, exactly: the rule for geometry, not display |
| `metres(v)` | a limit in a message: `shown(v)` under 10 m, `String(v)` from 10 up |

`shown` first rounds to a hundredth of its last digit, which drops float noise, then to the shown digits: 2.675 (stored as 2.67499...) reads "2.68".

## Limits

- Values are always metric on screen: no feet on screen, no square feet, no units setting ([roadmap.md](roadmap.md)).
- No variables.
- Fractions of an inch (`6 1/2"`) aren't read; `6.5"` says the same.
- Canvas fields need a hardware keyboard: soft keyboards and IME input aren't read.
