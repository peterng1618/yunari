import { describe, expect, it } from "vitest";
import { createPublishedStore } from "./published.js";

describe("the published theme", () => {
  it("starts empty and stays empty until something is published", () => {
    expect(createPublishedStore().read()).toBeUndefined();
  });

  it("answers with the id a save published, and a revision that moved", () => {
    const store = createPublishedStore();
    const before = store.revision();
    const after = store.publish("living-room");

    expect(after).not.toBe(before);
    expect(store.read()).toMatchObject({ id: "living-room" });
  });

  it("counts a clear as a change, so a display stops reloading for the theme", () => {
    const store = createPublishedStore();
    store.publish("living-room");
    const cleared = store.clear();

    expect(store.read()).toBeUndefined();
    expect(store.revision()).toBe(cleared);
  });
});
