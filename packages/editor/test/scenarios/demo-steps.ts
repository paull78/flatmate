import { helperLabelAt } from "../../src/view/helper";
import type { FakeShell } from "../fake-shell";

/** Demo step 2 (spec §1.4): W, Shift held, click the origin, type 6 / 4 / 6 along the cursor, click the first joint. */
export function drawRoom(shell: FakeShell): void {
  const shift = { shift: true };
  shell.key("w");
  shell.click({ x: 0, y: 0 }, shift);
  shell.moveTo({ x: 3, y: 0.2 }, shift); // right
  // Digits typed with Shift held: mapping the physical key to a digit is the web shell's rule (phase 4), so this
  // proves only that the value field takes digits whatever the modifiers.
  shell.type("6", shift);
  shell.key("Enter", shift);
  shell.moveTo({ x: 6.2, y: 2 }, shift); // up
  shell.type("4", shift);
  shell.key("Enter", shift);
  shell.moveTo({ x: 3, y: 4.2 }, shift); // left
  shell.type("6", shift);
  shell.key("Enter", shift);
  shell.click({ x: 0.02, y: 0.02 }, shift); // the first joint closes the chain
}

/**
 * Demo step 3: with Shift held, from the bottom wall's midpoint to the top wall's midpoint, then finish.
 * Needs the Wall tool active and idle, as `drawRoom` leaves it.
 */
export function drawDivider(shell: FakeShell): void {
  const shift = { shift: true };
  shell.click({ x: 3.04, y: 0.03 }, shift); // midpoint snap → (3, 0)
  shell.click({ x: 3.1, y: 3.97 }, shift); // vertical axis + midpoint snap → (3, 4)
  shell.key("Enter");
}

/** Demo step 4: Z, click (1.5, 2) and (4.5, 2). Each room gets a zone; the second stays selected. */
export function labelRooms(shell: FakeShell): void {
  shell.key("z");
  shell.click({ x: 1.5, y: 2 });
  shell.click({ x: 4.5, y: 2 });
}

/** Demo step 5: select the right exterior wall (a = (6, 0)), click its helper, type 3.5, Enter. */
export function resizeRightWall(shell: FakeShell): void {
  shell.key("v");
  shell.click({ x: 6, y: 1 });
  const selected = shell.state.selection[0];
  if (!selected || selected.table !== "walls") throw new Error("the right wall is not selected");
  const at = helperLabelAt(shell.doc(), selected.id, shell.state.camera);
  if (!at) throw new Error("the right wall has no helper dimension");
  shell.click(at);
  shell.type("3.5");
  shell.key("Enter");
}
