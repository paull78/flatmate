import { describe, expect, it } from "vitest";
import { emptyStored } from "@fm/protocol";
import * as server from "../src/index";

describe("@fm/server package entry", () => {
  it("exports the app, the in-memory repository and the domain validator", async () => {
    expect(typeof server.createServerApp).toBe("function");
    const repository = server.createInMemoryRepository();
    expect((await repository.create("Apartment")).meta.name).toBe("Apartment");
    // A new project's document (no state yet) is valid once upgraded, as the server does on load (layout-states.39).
    expect(server.domainValidator.validate(server.domainValidator.upgrade(emptyStored()))).toEqual({ ok: true });
  });
});
