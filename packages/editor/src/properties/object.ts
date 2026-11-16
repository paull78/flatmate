import { FAMILY_LABELS, OBJECT_KINDS, SIDE_IDS, armsOf, inEveryLayout, canSwitchKind, configOf, configsOf, familyKinds, hasOption, isObjectOption, isSide, isValidId, kindOf, presetOf, presetSize, withSide, type Document, type LayoutObject, type ObjectKind, type ObjectOption, type Placement, type Side, shown } from "@fm/domain";
import { turnInPlace } from "../tools/turn";
import type { Field } from "../view/view-model-types";
import { field, numberField, parseNumber, type FieldCommand, type Properties } from "./fields";
import { heightFieldCommand, heightFields } from "./heights";
import { stairFieldCommand, stairFields } from "./stair";
import { standsOnCommand, standsOnField } from "./stands-on";

/**
 * A selected placement (spec: layouts) in sections Object (kind, a drop-down when it can switch; what a built-in unit
 * opens into; name; a switch per option the kind lists, library.10), Size (preset,
 * when the kind has presets; width, depth; an `L` piece's back and left arms), Height (heights.ts), Placement (configuration, a choice when the kind has two;
 * Stands on, stands-on.ts; angle) and Use
 * zones (a switch per side, when the current configuration has a zone). A stair shows its Stair section (stair.ts) in
 * place of Size and Height.
 */
export function objectFields(doc: Document, placementId: string): Properties {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const kind = object ? kindOf(object.kind) : null;
  if (!p || !object || !kind) return { kind: "none" };
  const configs = configsOf(object);
  const choice = configs.length > 1;
  const config: Field = {
    // One configuration shows its label; a choice keeps the id, which the web's segmented control matches on.
    ...field("Placement", "config", "Configuration", choice ? p.config : (configOf(object, p.config)?.label ?? p.config), null, !choice),
    ...(choice ? { options: configs.map((c) => ({ value: c.id, label: c.label })) } : {}),
  };
  return {
    kind: "object",
    ...(kind.aggregate ? { breakApart: true } : {}),
    fields: [
      kindField(kind),
      ...opensInto(kind),
      field("Object", "name", "Name", object.name, null, false),
      ...optionSwitches(kind, object),
      ...(kind.stair ? stairFields(doc, p, object, kind.stair) : sizeFields(doc, p, object, kind)),
      config,
      standsOnField(doc, p),
      numberField("Placement", "angle", "Angle", String(p.rotation), "°", 1),
      ...linkedSwitch(doc, object),
      ...((configOf(object, p.config)?.zone ?? null) === null ? [] : zoneSwitches(p)),
    ],
  };
}

/** A piece's Size (its preset, width and depth, an `L` piece's arms, catalog.09) and Height sections. */
function sizeFields(doc: Document, p: Placement, object: LayoutObject, kind: ObjectKind): Field[] {
  const arms = armsOf(object);
  return [
    ...presetField(kind, object),
    numberField("Size", "width", "Width", shown(object.w[p.config] ?? 0), "m", 0.01),
    numberField("Size", "depth", "Depth", shown(object.d[p.config] ?? 0), "m", 0.01),
    ...(arms === null ? [] : [numberField("Size", "backArm", "Back arm", shown(arms.back), "m", 0.01), numberField("Size", "leftArm", "Left arm", shown(arms.left), "m", 0.01)]),
    ...heightFields(doc, p, object),
  ];
}

/**
 * The Kind (furnish.04, .17): a family member shows its family read-only (it switches with Opens into); any other kind
 * a drop-down of itself and every kind it can switch to, in catalogue order; read-only when there is none.
 */
function kindField(kind: ObjectKind): Field {
  if (kind.family !== null) return field("Object", "kind", "Kind", FAMILY_LABELS[kind.family], null);
  const options = OBJECT_KINDS.filter((k) => k.id === kind.id || canSwitchKind(kind.id, k.id)).map((k) => ({ value: k.id, label: k.label }));
  if (options.length < 2) return field("Object", "kind", "Kind", kind.label, null);
  return { ...field("Object", "kind", "Kind", kind.id, null, false), select: true, options };
}

const OPTION_LABELS: Readonly<Record<ObjectOption, string>> = { computer: "With computer", roundChairs: "Round chairs", leftEntry: "Enters from", hooks: "Hooks" };

/**
 * One field per option the kind lists, in the column's order, its field id the option's name (library.10): a switch,
 * except a winder's entry, a side and not an on/off, which is Right | Left on its "false" and "true" (steps.33).
 */
function optionSwitches(kind: ObjectKind, object: LayoutObject): Field[] {
  return kind.options.map((o) => {
    const base = field("Object", o, OPTION_LABELS[o], String(hasOption(object, o)), null, false);
    return o === "leftEntry" ? { ...base, options: [{ value: "false", label: "Right" }, { value: "true", label: "Left" }] } : { ...base, toggle: true };
  });
}

/** A family member's choice of the family's kinds, "Opens into" for a built-in unit (smart.03, .21); none otherwise. */
function opensInto(kind: ObjectKind): Field[] {
  if (kind.family === null) return [];
  const options = familyKinds(kind.family).map((k) => ({ value: k.id, label: k.opensInto ?? k.label }));
  return [{ ...field("Object", "opensInto", "Opens into", kind.id, null, false), options }];
}

/** The kind's size presets as a drop-down on the matching one, or a disabled "Custom" (smart.11, .17); none without presets. */
function presetField(kind: ObjectKind, object: LayoutObject): Field[] {
  if (kind.presets.length === 0) return [];
  const options = [...kind.presets.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom", disabled: true }];
  return [{ ...field("Size", "preset", "Preset", presetOf(object)?.id ?? "custom", null, false), select: true, options }];
}

/**
 * "Every layout" (review.07, .18), with two or more layouts: on for a linked piece, off for an exception; none for a
 * kind always in every layout (a stair, a beam, a wheel well).
 */
function linkedSwitch(doc: Document, object: LayoutObject): Field[] {
  if (Object.keys(doc.states).length < 2 || inEveryLayout(object.kind)) return [];
  return [{ ...field("Placement", "linked", "Every layout", String(object.linked === true), null, false), toggle: true }];
}

const SIDE_LABELS: Record<Side, string> = { front: "Front", back: "Back", left: "Left", right: "Right" };

/** One switch per side, `sides.<side>`, in SIDE_IDS order (smart.08). */
function zoneSwitches(p: Placement): Field[] {
  return SIDE_IDS.map((side) => ({ ...field("Use zones", `sides.${side}`, SIDE_LABELS[side], String(p.sides[side]), null, false), toggle: true }));
}

/**
 * A selected object's fields (spec: layouts): name renames the object everywhere; config switches this placement's
 * configuration; width sets every configuration's width and depth the current configuration's depth, in every layout
 * (smart.05); angle turns this placement. A depth edit sends the current width, so it also aligns stored widths.
 * `sides.<side>` turns that use zone on or off for this placement only ("true" or "false"; smart.08). opensInto
 * switches the object's kind within its family, in every layout (smart.21); kind switches it to any kind
 * `canSwitchKind` allows (its own kind is the domain's no-op, as opensInto), and sends nothing otherwise (furnish.17). preset sets the width and every
 * configuration's depth, and the heights it gives, to one of the kind's presets, in one edit; "Custom" and unknown ids send nothing (smart.11).
 * standsOn moves this placement onto the floor or an offered deck, in place (decks.11). backArm and leftArm set an `L`
 * piece's arm with its current width and depths, in one size command (catalog.18). An option's name ("true" or
 * "false") turns that option on or off, in every layout; the domain refuses one the kind doesn't list (library.10). linked
 * links the piece across layouts or makes it an exception (setLinked, review.07).
 */
export function objectFieldCommand(doc: Document, placementId: string, fieldId: string, value: string): FieldCommand {
  const p = doc.placements[placementId];
  const object = p ? doc.objects[p.object] : undefined;
  if (!p || !object) return null;
  const rule = kindOf(object.kind)?.stair;
  const stair = rule ? stairFieldCommand(doc, p, object, rule, fieldId, value) : undefined;
  if (stair !== undefined) return stair;
  const n = parseNumber(value);
  switch (fieldId) {
    case "name":
      return { type: "renameObject", objectId: object.id, name: value };
    case "opensInto":
      return { type: "setObjectKind", objectId: object.id, kind: value };
    case "kind":
      return value === object.kind || canSwitchKind(object.kind, value) ? { type: "setObjectKind", objectId: object.id, kind: value } : null;
    case "preset": {
      const size = presetSize(object.kind, value, object); // its heights where it gives them, else the piece's (catalog.07)
      const w = size?.w[p.config];
      return size && w !== undefined ? { type: "setObjectSize", objectId: object.id, w, d: size.d, h: size.h, z: size.z } : null;
    }
    case "config":
      return { type: "setConfiguration", placementId: p.id, config: value };
    case "width":
      return Number.isFinite(n) ? { type: "setObjectSize", objectId: object.id, w: n, d: {} } : "notANumber";
    case "depth":
      if (!Number.isFinite(n)) return "notANumber";
      return { type: "setObjectSize", objectId: object.id, w: object.w[p.config] ?? n, d: { [p.config]: n } };
    case "backArm":
    case "leftArm": {
      // The current width and depths with the new arm, so the domain checks the arm against them (catalog.18).
      const arms = armsOf(object);
      if (arms === null) return null;
      if (!Number.isFinite(n)) return "notANumber";
      const w = object.w[p.config];
      return w === undefined ? null : { type: "setObjectSize", objectId: object.id, w, d: {}, arms: fieldId === "backArm" ? { ...arms, back: n } : { ...arms, left: n } };
    }
    case "angle":
      return Number.isInteger(n) ? turnInPlace(doc, p, n) : "notWhole";
    case "standsOn":
      return standsOnCommand(doc, p, value);
    case "linked":
      return value === "true" || value === "false" ? { type: "setLinked", placementId: p.id, on: value === "true" } : null;
    default:
      if (isObjectOption(fieldId)) return value === "true" || value === "false" ? { type: "setOption", objectId: object.id, option: fieldId, on: value === "true" } : null;
      return heightFieldCommand(doc, p, object, fieldId, value) ?? sideCommand(p, fieldId, value);
  }
}

function sideCommand(p: Placement, fieldId: string, value: string): FieldCommand {
  const side = fieldId.startsWith("sides.") ? fieldId.slice("sides.".length) : null;
  if (!isSide(side) || (value !== "true" && value !== "false")) return null;
  return { type: "setZoneSides", placementId: p.id, sides: withSide(p.sides, side, value === "true") };
}
