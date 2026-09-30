import { describe, expect, it } from "vitest";
import { displayNameFrom, serverUrlFrom } from "../src/identity";

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
