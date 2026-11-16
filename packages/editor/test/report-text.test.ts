import { describe, expect, it } from "vitest";
import { parseReport, reportStrings } from "../src/export/report-text";

// A report's light marks (AC-09): `#`, `##`, paragraphs, `**bold**` and `*italic*`. Anything else prints as typed.

const paragraph = (text: string) => ({ kind: "paragraph", runs: [{ text }] });

describe("a report's marks", () => {
  it("parses headings, paragraphs and inline marks", () => {
    expect(parseReport("# Studio\n\n## Description\n\nThe plan fits a **whole** home in *7 metres*.\n\nA second one.")).toEqual([
      { kind: "title", text: "Studio" },
      { kind: "heading", text: "Description" },
      { kind: "paragraph", runs: [{ text: "The plan fits a " }, { text: "whole", style: "bold" }, { text: " home in " }, { text: "7 metres", style: "oblique" }, { text: "." }] },
      paragraph("A second one."),
    ]);
  });

  it("an unmatched * prints as typed", () => {
    for (const typed of ["one * two", "*half", "half*", "**half", "half**", "2 * 3 * 4", "****", "* spaced *", "** spaced **"]) expect(parseReport(typed)).toEqual([paragraph(typed)]);
  });

  it("a mark closes at the nearest pair, and what's left over prints as typed", () => {
    expect(parseReport("***both***")).toEqual([{ kind: "paragraph", runs: [{ text: "*" }, { text: "both", style: "bold" }, { text: "*" }] }]);
    expect(parseReport("*a* *b*")).toEqual([{ kind: "paragraph", runs: [{ text: "a", style: "oblique" }, { text: " " }, { text: "b", style: "oblique" }] }]);
  });

  it("unknown marks print as typed", () => {
    for (const typed of ["### Deep", "#No space", "- a list", "> a quote", "`code`", "[a](b)", "#"]) expect(parseReport(typed)).toEqual([paragraph(typed)]);
  });

  it("marks in a heading print as typed: it's all bold already", () => {
    expect(parseReport("## A **big** room")).toEqual([{ kind: "heading", text: "A **big** room" }]);
  });

  it("only a first # is the title; a later one is a heading", () => {
    expect(parseReport("# One\n\n# Two")).toEqual([{ kind: "title", text: "One" }, { kind: "heading", text: "Two" }]);
    expect(parseReport("Text\n\n# Late")).toEqual([paragraph("Text"), { kind: "heading", text: "Late" }]);
  });

  it("headings need no blank line round them; a single line break is a space, as on the mockup", () => {
    expect(parseReport("# T\n## H\none\ntwo\n\n\n  three  \r\nfour")).toEqual([{ kind: "title", text: "T" }, { kind: "heading", text: "H" }, paragraph("one two"), paragraph("three four")]);
  });

  it("tabs and repeated spaces read as one space, so a tab can't print as ?", () => {
    expect(parseReport("a\t b   c")).toEqual([paragraph("a b c")]);
  });

  it("no text, no blocks", () => {
    expect(parseReport("")).toEqual([]);
    expect(parseReport(" \n\n \t\n")).toEqual([]);
  });

  it("what prints has no line breaks, so an ordinary report can't set off the characters warning", () => {
    const strings = reportStrings("# T\r\n\r\n## H\n\na **b**\nc\n");
    expect(strings).toEqual(["T", "H", "a ", "b", " c"]);
  });
});
