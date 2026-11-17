import { describe, expect, it } from "vitest";
import { MAX_NAME_CHARS, parseClientMessage } from "@fm/protocol";
import { displayNameFrom, serverUrlFrom, serverUrlProblem } from "../src/identity";

describe("displayNameFrom", () => {
  it("reads ?name=", () => {
    expect(displayNameFrom("?name=Alice")).toBe("Alice");
  });

  it("trims and defaults to Guest", () => {
    expect(displayNameFrom("?name=%20Bob%20")).toBe("Bob");
    expect(displayNameFrom("?name=%20%20")).toBe("Guest");
    expect(displayNameFrom("")).toBe("Guest");
  });
});

describe("displayNameFrom with a long name (knownbugs AC-11)", () => {
  it("cuts it to the protocol's limit, so the hello parses and the client connects", () => {
    const name = displayNameFrom(`?name=${"a".repeat(300)}`);
    expect(name).toBe("a".repeat(MAX_NAME_CHARS));
    expect(parseClientMessage(JSON.stringify({ type: "hello", clientId: "tab-1", name })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "hello", clientId: "tab-1", name: "a".repeat(300) })).ok).toBe(false); // the limit is real
  });

  it("never cuts through a pair of surrogates, and never ends on a space", () => {
    const pairs = displayNameFrom(`?name=${encodeURIComponent("a" + "😀".repeat(150))}`); // the limit falls inside the 100th emoji
    expect(pairs).toBe("a" + "😀".repeat(99));
    expect(displayNameFrom(`?name=${encodeURIComponent("b".repeat(199) + " c")}`)).toBe("b".repeat(199));
  });
});

describe("serverUrlFrom", () => {
  it("prefers ?server= over the build-time URL", () => {
    expect(serverUrlFrom("?server=ws%3A%2F%2Flocalhost%3A8788", "ws://localhost:8787")).toBe("ws://localhost:8788");
    expect(serverUrlFrom("", "ws://localhost:8787")).toBe("ws://localhost:8787");
  });

  it("is local mode without a URL, or with ?server=off", () => {
    expect(serverUrlFrom("", undefined)).toBeNull();
    expect(serverUrlFrom("", "  ")).toBeNull();
    expect(serverUrlFrom("?server=off", "ws://localhost:8787")).toBeNull();
  });
});

describe("serverUrlProblem (fixes AC-06)", () => {
  it.each([["ws://localhost:8787"], ["wss://example.test/x"], [null]])("takes %s", (url) => {
    expect(serverUrlProblem(url)).toBeNull();
  });

  it.each([["localhost:8787"], ["http://localhost:8787"], ["ws:"], ["not a url"]])("refuses %s, naming what it wants", (url) => {
    expect(serverUrlProblem(url)).toMatch(/ws:\/\/ or wss:\/\//);
  });
});
