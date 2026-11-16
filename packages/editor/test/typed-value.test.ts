import { describe, expect, it } from "vitest";
import { cantRead, editedValue, readValue, typedLine, valueChar } from "../src/typed-value";

describe("readValue", () => {
  it.each([
    ["2.80", 2.8],
    ["2,80", 2.8],
    [".5", 0.5],
    ["3.", 3],
    ["2.80-0.60", 2.2],
    ["280cm", 2.8],
    ["15mm", 0.015],
    ["2.8m", 2.8],
    ["3m-60cm", 2.4],
    ["3m+60cm", 3.6],
    ["(2+3)/2", 2.5],
    ["2×3", 6],
    ["2*3", 6],
    ["2−1", 1],
    ["2 + 3", 5],
    ["  2  cm ", 0.02],
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["10/2/5", 1],
    ["10-2-3", 5],
    ["((1))", 1],
    ["-0.5", -0.5],
    ["2*-1", -2],
    ["2--1", 3],
    ["-(1+1)", -2],
    ["60CM", 0.6],
    ["1m/2cm", 50],
    ["0", 0],
  ])("%s reads %d", (text, value) => {
    expect(readValue(text, "metres")).toBeCloseTo(value, 9);
  });

  it("cm is exact, not float noise from a multiplication", () => {
    expect(readValue("280cm", "metres")).toBe(2.8);
    expect(readValue("15mm", "metres")).toBe(0.015);
  });

  it.each(["", " ", ".", ",", "2.8-", "-", "+2", "2..8", "2,8,1", "2.8.1", "1/0", "1/(2-2)", "3x", "x3", "1e3", "0x10", "Infinity", "NaN", "3m 60cm", "2 3", "3m60cm", "3 m 60", "2m m", "2km", "2c", "(2", "2)", "()", "2(3)", "(2)3", "2**3", "2//3", "--1", "50%", "1_000"])("%j is unreadable", (text) => {
    expect(readValue(text, "metres")).toBeNull();
  });

  it("a field not in metres reads sums and refuses units", () => {
    expect(readValue("90+45", "plain")).toBe(135);
    expect(readValue("2m", "plain")).toBeNull();
    expect(readValue("45cm", "plain")).toBeNull();
    expect(readValue("15mm+1", "plain")).toBeNull();
  });

  it("float noise comes off a result, and a real fraction stays", () => {
    expect(readValue("0.1+0.2", "metres")).toBe(0.3);
    expect(readValue("2.80-0.60", "metres")).toBe(2.2);
    expect(readValue("0.2005", "metres")).toBe(0.2005);
    expect(readValue("10/3", "metres")).toBe(3.333333333);
  });

  it("a very long text or number is unreadable, and never overflows the stack", () => {
    expect(readValue("(".repeat(100_000), "metres")).toBeNull();
    expect(readValue(`${"(".repeat(50)}1${")".repeat(50)}`, "metres")).toBe(1);
    expect(readValue("9".repeat(400), "metres")).toBeNull();
  });
});

// Feet and inches (spec feet): a length in feet and inches is one number to the grammar (feet.06), in metres.
describe("readValue: feet and inches", () => {
  const FT = 0.3048;
  const IN = 0.0254;

  it.each(["8'6\"", "8' 6\"", "8′6″", "8ft 6in", "8 ft 6 in", "8ft 6", "8FT 6IN", "102\"", "102in", "8.5'", "8.5ft", "8'6"])("%s reads 8 ft 6 in (AC-01)", (text) => {
    expect(readValue(text, "metres")).toBe(2.5908);
  });

  it.each(["8'", "8ft", "8 '"])("%s reads 8 ft (AC-01)", (text) => {
    expect(readValue(text, "metres")).toBe(2.4384);
  });

  it.each([
    ["8'+0.5m", 2.9384],
    ["3m-6\"", 2.8476],
    ["2*4'", 2.4384],
    ["(8'6\")/2", 1.2954],
    ["4'+4'", 2.4384],
    ["-6\"", -0.1524],
  ])("%s mixes with metres in a sum (AC-02)", (text, value) => {
    expect(readValue(text, "metres")).toBe(value);
  });

  it.each([
    ["8'-6\"", 2.5908],
    ["8'-6in", 2.5908],
    ["8'-6", 2.5908],
    ["8' - 6\"", 2.5908],
    ["8ft-6in", 2.5908],
    ["8'-0.5m", 1.9384],
    ["8'-1'", 2.1336],
    ["8'-(6\")", 2.286],
    ["8'-6\"-1'", 2.286],
  ])("%s: the drafting dash joins inches, and subtracts anything else (AC-03)", (text, value) => {
    expect(readValue(text, "metres")).toBe(value);
  });

  it.each(["8' 6m", "6\" 8'", "8'6\"2", "8''", "6 1/2\"", "8'6'", "8\"6", "8'6\"\"", "8f", "8i", "8ft6ft", "'6", "8'-", "8 inch", "8feet"])("%j is unreadable (AC-04)", (text) => {
    expect(readValue(text, "metres")).toBeNull();
  });

  it("a field without units refuses feet and inches (AC-04)", () => {
    expect(readValue("6'", "plain")).toBeNull();
    expect(readValue("6\"", "plain")).toBeNull();
    expect(readValue("6ft", "plain")).toBeNull();
  });

  it("every form reads the same, feet × 0.3048 + inches × 0.0254, over 1,000 lengths (AC-08)", () => {
    let seed = 7;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 1000; i += 1) {
      const [f, n] = [random(61), random(12)];
      const want = Math.round((f * FT + n * IN) * 1e9) / 1e9;
      const forms = [`${f}'${n}"`, `${f}' ${n}"`, `${f}ft ${n}in`, `${f} ft ${n} in`, `${f}'${n}`, `${f}'-${n}"`, `${f * 12 + n}"`, `${f * 12 + n}in`];
      for (const form of forms) expect(readValue(form, "metres"), form).toBe(want);
    }
  });
});

describe("typedLine: feet and inches", () => {
  it("shows the result in metres, three decimals when the millimetre needs them", () => {
    expect(typedLine("8'6\"")).toEqual({ value: "8'6\" = 2.591", unit: "m" });
    expect(typedLine("8'")).toEqual({ value: "8' = 2.438", unit: "m" });
    expect(typedLine("10'")).toEqual({ value: "10' = 3.048", unit: "m" });
    expect(typedLine("8'-")).toEqual({ value: "8'-", unit: null });
  });
});

describe("valueChar", () => {
  const typeAll = (keys: string): string => [...keys].reduce((value, key) => value + (valueChar(value, key) ?? ""), "");

  it.each([..."0123456789", ".", ",", "+", "-", "*", "/"])("%s is taken on an empty and on a started value", (key) => {
    expect(valueChar("", key)).toBe(key);
    expect(valueChar("2", key)).toBe(key);
  });

  it("Space is typed only into a started value", () => {
    expect(valueChar("", " ")).toBeNull();
    expect(valueChar("2", " ")).toBe(" ");
  });

  it.each([
    ["2", "c", "c"],
    ["2", "C", "c"],
    ["2", "m", "m"],
    ["2", "M", "m"],
    ["2.", "m", "m"],
    ["2 ", "c", "c"],
    ["2c", "m", "m"],
    ["2c", "M", "m"],
    ["2m", "m", "m"],
    ["2 m", "m", "m"],
  ])("%j then %s types %s", (value, key, char) => {
    expect(valueChar(value, key)).toBe(char);
  });

  it.each([
    ["", "m"],
    ["", "c"],
    ["2+", "m"],
    ["2+", "c"],
    ["2+ ", "m"],
    ["2mm", "m"],
    ["2cm", "m"],
    ["2cm", "c"],
    ["2m", "c"],
    ["2c", "c"],
    ["c", "m"],
    ["m", "m"],
    ["2", "k"],
  ])("%j then %s is not typed", (value, key) => {
    expect(valueChar(value, key)).toBeNull();
  });

  it.each(["(", ")", "x", "×", "_", ";", "Enter", "Backspace", "Shift", "Escape", "ArrowUp"])("%s is not typed", (key) => {
    expect(valueChar("2", key)).toBeNull();
  });

  it("every example of the spec can be typed key by key", () => {
    for (const text of ["2.80-0.60", "280cm", "15mm", "2.8m", "3m-60cm", "3m+60cm", "2,80", "2 + 3", "60 cm"]) expect(typeAll(text)).toBe(text);
  });
  // Feet and inches (spec feet, AC-06): the marks and the letters f, t, i, n count only after a number.
  it.each(["'", '"', "f", "t", "i", "n", "F", "I"])("%s is not typed with nothing typed, or after an operator or a mark", (key) => {
    expect(valueChar("", key)).toBeNull();
    expect(valueChar("2+", key)).toBeNull();
    expect(valueChar("8'", key)).toBeNull();
  });

  it.each([
    ["8", "'", "'"],
    ["8 ", "'", "'"],
    ["8'6", '"', '"'],
    ["102", '"', '"'],
    ["8", "f", "f"],
    ["8", "F", "f"],
    ["8f", "t", "t"],
    ["8f", "T", "t"],
    ["8ft 6", "i", "i"],
    ["8ft 6i", "n", "n"],
    ["8 ft 6 ", "i", "i"],
    ["8'", "6", "6"],
    ["8'", "-", "-"],
  ])("%j then %s types %s (AC-06)", (value, key, char) => {
    expect(valueChar(value, key)).toBe(char);
  });

  it.each([
    ["8", "t"],
    ["8", "n"],
    ["8i", "t"],
    ["8f", "n"],
    ["8ft", "t"],
    ["8in", "n"],
    ["8'", '"'],
    ['8"', "'"],
    ["8m", "f"],
  ])("%j then %s is not typed (AC-06)", (value, key) => {
    expect(valueChar(value, key)).toBeNull();
  });

  it("every feet form of the spec can be typed key by key", () => {
    for (const text of ["8'6\"", "8' 6\"", "8ft 6in", "8 ft 6 in", "8ft 6", "102\"", "102in", "8.5'", "8.5ft", "8'6", "8'-6\"", "8'-6in", "8'+0.5m", "3m-6\""]) {
      expect(typeAll(text), text).toBe(text);
      expect(readValue(typeAll(text), "metres"), text).not.toBeNull();
    }
  });
});

describe("typedLine", () => {
  it.each([
    ["", "", "m"],
    ["2.80", "2.80", "m"],
    ["2,80", "2,80", "m"],
    ["6", "6", "m"],
    ["3.", "3.", "m"],
    ["2.80-", "2.80-", null],
    [".", ".", null],
    ["2.80-0.6", "2.80-0.6 = 2.20", "m"],
    ["280cm", "280cm = 2.80", "m"],
    ["10/3", "10/3 = 3.333", "m"],
    ["2.8+0.005", "2.8+0.005 = 2.805", "m"],
    ["2 + 3", "2 + 3 = 5.00", "m"],
    ["2 + 3 ", "2 + 3 = 5.00", "m"],
    ["3m 60cm", "3m 60cm", null],
  ])("%j shows %j with unit %s", (typed, value, unit) => {
    expect(typedLine(typed)).toEqual({ value, unit });
  });

  it("float noise never reaches the hint", () => {
    expect(typedLine("0.1+0.2").value).toBe("0.1+0.2 = 0.30");
    expect(typedLine("2.80-0.60").value).toBe("2.80-0.60 = 2.20");
  });
});

describe("editedValue", () => {
  it("adds what the key types and trims on Backspace; other keys are not its own", () => {
    expect(editedValue("2", "+")).toBe("2+");
    expect(editedValue("2", "M")).toBe("2m");
    expect(editedValue("2+", "Backspace")).toBe("2");
    expect(editedValue("", "Backspace")).toBe("");
    expect(editedValue("", " ")).toBeNull();
    expect(editedValue("2", "Enter")).toBeNull();
    expect(editedValue("2", "x")).toBeNull();
  });
});

describe("cantRead", () => {
  it("quotes the text; a blank has nothing to quote", () => {
    expect(cantRead("2.8-")).toBe("Can't read 2.8-");
    expect(cantRead(" 2.8- ")).toBe("Can't read 2.8-");
    expect(cantRead("")).toBe("Enter a number");
    expect(cantRead("  ")).toBe("Enter a number");
  });
});
