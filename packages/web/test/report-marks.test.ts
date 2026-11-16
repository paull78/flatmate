import { describe, expect, it } from "vitest";
import { boxText, lineStyleEdit, markEdit, type BoxEdit } from "../src/panels/report-marks";

// The style bar's text edits (sheetset.07, .50), as pure functions. What they write must print as meant: marks touch their
// words and don't nest, a blank line ends a paragraph, and marks inside `#` and `##` print as typed. `[` and `]` in a case
// stand for the selection, before and after.

function select(marked: string): { value: string; start: number; end: number } {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
}
function applied(value: string, edit: BoxEdit): string {
  const text = value.slice(0, edit.from) + edit.insert + value.slice(edit.to);
  return `${text.slice(0, edit.start)}[${text.slice(edit.start, edit.end)}]${text.slice(edit.end)}`;
}
const bold = (marked: string): string => {
  const { value, start, end } = select(marked);
  return applied(value, markEdit(value, start, end, "**") ?? { from: 0, to: 0, insert: "", start, end });
};
const italic = (marked: string): string => {
  const { value, start, end } = select(marked);
  return applied(value, markEdit(value, start, end, "*") ?? { from: 0, to: 0, insert: "", start, end });
};
const heading = (marked: string, prefix: "# " | "## " = "## "): string => {
  const { value, start, end } = select(marked);
  return applied(value, lineStyleEdit(value, start, end, prefix));
};

describe("B and I", () => {
  it("B wraps the selection in **", () => {
    expect(bold("a [big] room")).toBe("a **[big]** room");
  });

  it("I wraps the selection in *", () => {
    expect(italic("a [big] room")).toBe("a *[big]* room");
  });

  it("marks go against the words, past spaces the selection took in", () => {
    expect(bold("a[ big ]room")).toBe("a **[big]** room");
    expect(italic("[  big\t]room")).toBe("  *[big]*\troom");
  });

  it("with no selection, the word at the caret, and the caret stays a caret, so the next key adds to the word", () => {
    expect(bold("a b[]ig room")).toBe("a **b[]ig** room");
    expect(bold("a big[] room")).toBe("a **big[]** room");
    expect(italic("a []big room")).toBe("a *[]big* room");
  });

  it("with no word at the caret, a pair to type between", () => {
    expect(bold("a [] room")).toBe("a **[]** room");
    expect(italic("[]")).toBe("*[]*");
  });

  it("a selection of only spaces is a caret at its start", () => {
    expect(bold("a[  ]b")).toBe("**a[]**  b");
  });

  it("each line gets its own marks, as a blank line ends a paragraph", () => {
    expect(bold("[one\n\ntwo]")).toBe("[**one**\n\n**two**]");
    expect(bold("x [one\ntwo] y")).toBe("x [**one**\n**two**] y");
  });

  it("B again takes it off, whether or not the selection includes the marks", () => {
    expect(bold("a **[big]** room")).toBe("a [big] room");
    expect(bold("a [**big**] room")).toBe("a [big] room");
    expect(bold("a **b[]ig** room")).toBe("a b[]ig room");
  });

  it("B again over several lines takes it off all of them", () => {
    expect(bold("[**one**\n\n**two**]")).toBe("[one\n\ntwo]");
    expect(bold("[**one**\n\ntwo]")).toBe("[**one**\n\n**two**]");
  });

  it("marks don't nest: I on bold words turns them italic, and marks inside the selection go", () => {
    expect(italic("a **[big]** room")).toBe("a *[big]* room");
    expect(bold("[a *big* room]")).toBe("**[a big room]**");
  });

  it("part of a marked run takes the whole run, as marks don't nest", () => {
    expect(bold("**a [big] room**")).toBe("[a big room]");
    expect(italic("**a [big] room**")).toBe("*[a big room]*");
  });

  it("a selection reaching into a run takes that run in", () => {
    expect(italic("one **t[wo** three] four")).toBe("one *[two three]* four");
  });

  it("does nothing on a heading, where marks print as typed", () => {
    expect(bold("# [Title]")).toBe("# [Title]");
    expect(italic("## [Heading]")).toBe("## [Heading]");
    expect(markEdit("## Heading", 3, 5, "**")).toBeNull();
  });

  it("over a heading and a paragraph, only the paragraph", () => {
    expect(bold("[# Title\n\nBody]")).toBe("[# Title\n\n**Body**]");
  });

  it("does nothing on a literal star, which would break the marks", () => {
    expect(markEdit("2 * 3", 0, 5, "**")).toBeNull();
    expect(bold("[2 * 3]")).toBe("[2 * 3]");
    expect(bold("[2 * 3\n\nfour]")).toBe("[2 * 3\n\n**four**]");
  });

  it("a word without a neighbouring star is untouched beside a marked one", () => {
    expect(italic("**one** [two] **three**")).toBe("**one** *[two]* **three**");
  });
});

describe("Title and Heading", () => {
  it("Heading prefixes the line, and the caret keeps its place, so typing goes on", () => {
    expect(heading("Fi[]rst\n\nSecond")).toBe("## Fi[]rst\n\nSecond");
    expect(heading("First\n\nSec[]ond")).toBe("First\n\n## Sec[]ond");
    expect(heading("First[]")).toBe("## First[]");
  });

  it("Title prefixes with one mark", () => {
    expect(heading("Fi[]rst", "# ")).toBe("# Fi[]rst");
  });

  it("the same again takes it off, and the other swaps", () => {
    expect(heading("## Fi[]rst")).toBe("Fi[]rst");
    expect(heading("# Fi[]rst", "# ")).toBe("Fi[]rst");
    expect(heading("# Fi[]rst")).toBe("## Fi[]rst");
    expect(heading("## Fi[]rst", "# ")).toBe("# Fi[]rst");
  });

  it("a selection on one line stays what it was", () => {
    expect(heading("A [big] room")).toBe("## A [big] room");
    expect(heading("## A [big] room")).toBe("A [big] room");
  });

  it("a caret in the old prefix lands at the words", () => {
    expect(heading("#[]# First")).toBe("[]First");
  });

  it("marks go, as they'd print as typed in a heading", () => {
    expect(heading("A **big** *ro[]om*")).toBe("## A big ro[]om");
  });

  it("a literal star stays", () => {
    expect(heading("2 * 3[]")).toBe("## 2 * 3[]");
  });

  it("an empty line takes the prefix with the caret after it", () => {
    expect(heading("One\n[]\nTwo")).toBe("One\n## []\nTwo");
    expect(heading("[]")).toBe("## []");
  });

  it("each line in the selection, leaving blank ones", () => {
    expect(heading("[One\n\nTwo]")).toBe("[## One\n\n## Two]");
  });

  it("a selection part way through lines takes the whole lines", () => {
    expect(heading("On[e\nT]wo")).toBe("[## One\n## Two]");
  });
});

describe("the box's text", () => {
  it("line breaks as a text box reports them, or React would reset the caret on each render", () => {
    expect(boxText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
