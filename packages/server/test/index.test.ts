import { describe, expect, it } from "vitest";
import * as server from "../src/index";

describe("@fm/server package entry", () => {
  it("exports the app, the in-memory repository and the domain validator", async () => {
    expect(typeof server.createServerApp).toBe("function");
    const repository = server.createInMemoryRepository();
    expect((await repository.create("Apartment")).meta.name).toBe("Apartment");
    expect(server.domainValidator.validate({ joints: {}, walls: {}, zoneLabels: {} })).toEqual({ ok: true });
  });
});
