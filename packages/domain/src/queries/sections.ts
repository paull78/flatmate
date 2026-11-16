import type { Document, Section } from "../model";
import { SECTION_LETTERS } from "../section";

/** The rows in letter order. */
export function sectionsOf(doc: Document): Section[] {
  return Object.keys(doc.sections).sort().flatMap((id) => doc.sections[id] ?? []);
}

/** The letter a new section takes: the first with no row, or undefined when every letter has one. */
export function nextSectionLetter(doc: Document): string | undefined {
  return [...SECTION_LETTERS].find((letter) => !doc.sections[letter]);
}

/** What a section is called, on the plan and in a title: "B–B". */
export const sectionLabel = (id: string): string => `${id}–${id}`;

/** A Section sheet's title until someone names it, which follows its section. */
export const sectionSheetTitle = (id: string): string => `Section ${sectionLabel(id)}`;
