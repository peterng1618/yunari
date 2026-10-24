import { describe, expect, it } from "vitest";
import { createPublishedStore } from "./published.js";

describe("the published document", () => {
  it("starts empty and stays empty until something is published", () => {
    expect(createPublishedStore().read()).toBeUndefined();
  });

  it("answers with what was published, and a revision that moved", () => {
    const store = createPublishedStore();
    const before = store.revision();
    const after = store.publish("living-room", {
      schemaVersion: "2.0.0",
    } as never);

    expect(after).not.toBe(before);
    expect(store.read()).toMatchObject({ id: "living-room" });
  });

  it("counts a stop as a change, so a display stops showing what was published", () => {
    const store = createPublishedStore();
    store.publish("living-room", {} as never);
    const stopped = store.clear();

    expect(store.read()).toBeUndefined();
    expect(store.revision()).toBe(stopped);
  });
});
