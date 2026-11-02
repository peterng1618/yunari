import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDraftStore } from "./drafts.js";
import {
  type FakeHost,
  startFakeHost,
  testEnvelope,
} from "./testing/fake-host.js";
import type { ThemeCredits } from "./types.js";

const hosts: FakeHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

const credits: ThemeCredits = {
  format: "yunari-theme-credits",
  version: 1,
  entries: [],
};

describe("InMemoryDraftStore", () => {
  it("creates a new draft without touching the host", async () => {
    const host = await startFakeHost(() => undefined);
    hosts.push(host);
    const drafts = new InMemoryDraftStore();

    const draft = drafts.create({
      id: "fresh",
      envelope: testEnvelope("fresh"),
    });
    drafts.setMetadata("fresh", {
      name: "Renamed",
      themeLanguage: "en",
    });
    drafts.setAsset("fresh", "assets/dot.png", new Uint8Array([1]));
    drafts.setCredits("fresh", credits);

    expect(draft.origin).toBe("new");
    expect(drafts.read("fresh").envelope.metadata?.name).toBe("Renamed");
    expect(drafts.read("fresh").assets["assets/dot.png"]).toEqual(
      new Uint8Array([1]),
    );
    expect(drafts.read("fresh").credits).toBe(credits);
    expect(host.requests).toHaveLength(0);
  });

  it("opens a host theme as a copy with its base", async () => {
    const host = await startFakeHost(() => undefined);
    hosts.push(host);
    const drafts = new InMemoryDraftStore();
    const assets = { "assets/dot.png": new Uint8Array([2]) };

    const draft = drafts.open("stored", {
      envelope: testEnvelope("stored"),
      assets,
      credits,
      base: "hash",
    });

    expect(draft.origin).toBe("opened");
    expect(draft.base).toBe("hash");
    expect(draft.assets["assets/dot.png"]).toEqual(new Uint8Array([2]));
    expect(draft.credits).toBe(credits);
    expect(host.requests).toHaveLength(0);
  });

  it("refuses to open the same id twice", () => {
    const drafts = new InMemoryDraftStore();
    drafts.create({ id: "fresh", envelope: testEnvelope("fresh") });

    expect(() =>
      drafts.open("fresh", {
        envelope: testEnvelope("fresh"),
        assets: {},
      }),
    ).toThrow(/draft "fresh" is already open/u);
  });

  it("names the draft it cannot read", () => {
    const drafts = new InMemoryDraftStore();

    expect(() => drafts.read("gone")).toThrow(/No draft "gone" is open\./u);
  });

  it("discards a draft and reports whether one was there", () => {
    const drafts = new InMemoryDraftStore();
    drafts.create({ id: "fresh", envelope: testEnvelope("fresh") });

    expect(drafts.discard("fresh")).toBe(true);
    expect(drafts.discard("fresh")).toBe(false);
    expect(() => drafts.read("fresh")).toThrow(/No draft "fresh" is open\./u);
  });

  it("clears credits when none are set", () => {
    const drafts = new InMemoryDraftStore();
    drafts.create({
      id: "fresh",
      envelope: testEnvelope("fresh"),
      credits,
    });

    drafts.setCredits("fresh", undefined);

    expect(drafts.read("fresh").credits).toBeUndefined();
  });
});
