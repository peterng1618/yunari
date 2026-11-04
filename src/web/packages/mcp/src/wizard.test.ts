import { expect, it } from "vitest";
import { runWizard } from "./wizard.js";

function scripted(answers: readonly string[]) {
  const queue = [...answers];
  return {
    io: {
      ask: async () => queue.shift() ?? "",
      write: () => {},
    },
  };
}

it("takes its defaults from an empty answer list", async () => {
  const { io } = scripted(["", "", "", "", "", ""]);
  expect(
    await runWizard(io, "/work", ["claude-code"], async () => undefined),
  ).toEqual({
    agents: ["claude-code"],
    scope: "global",
    skill: true,
    autoApprove: true,
    cwd: "/work",
  });
});

it("accepts a comma list of agents", async () => {
  const { io } = scripted(["1,3", "2", "n", "2", "", ""]);
  const choices = await runWizard(
    io,
    "/work",
    ["claude-code", "cursor", "vscode"],
    async () => undefined,
  );
  expect(choices?.agents).toEqual(["claude-code", "cursor"]);
  expect(choices?.scope).toBe("local");
  expect(choices?.skill).toBe(false);
  expect(choices?.autoApprove).toBe(false);
});

it("pins the probed host on an empty answer and can decline it", async () => {
  const pinned = await runWizard(
    scripted(["", "", "", "", "", ""]).io,
    "/work",
    [],
    async () => "http://127.0.0.1:5227",
  );
  expect(pinned?.url).toBe("http://127.0.0.1:5227");

  const unpinned = await runWizard(
    scripted(["", "", "", "", "none", ""]).io,
    "/work",
    [],
    async () => "http://127.0.0.1:5227",
  );
  expect(unpinned ?? {}).not.toHaveProperty("url");
});

it("writes nothing when the summary is declined", async () => {
  const { io } = scripted(["", "", "", "", "", "n"]);
  expect(
    await runWizard(io, "/work", [], async () => undefined),
  ).toBeUndefined();
});
