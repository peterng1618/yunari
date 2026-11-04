import { expect, it } from "vitest";
import { parseInstallArgs, resolveChoices } from "./choices.js";

it("parses repeated agents and every flag", () => {
  expect(
    parseInstallArgs([
      "install",
      "--agent",
      "claude-code",
      "--agent",
      "cursor",
      "--scope",
      "local",
      "--no-skill",
      "--auto-approve",
      "none",
      "--url",
      "http://127.0.0.1:5300",
      "--yes",
      "--json",
    ]),
  ).toEqual({
    kind: "choices",
    choices: {
      agents: ["claude-code", "cursor"],
      scope: "local",
      skill: false,
      autoApprove: false,
      url: "http://127.0.0.1:5300",
    },
    yes: true,
    json: true,
  });
});

it("defaults every unspecified choice", () => {
  expect(resolveChoices({}, "/work")).toEqual({
    agents: ["claude-code"],
    scope: "global",
    skill: true,
    autoApprove: true,
    cwd: "/work",
  });
});

it("rejects an unknown flag and a bad scope", () => {
  expect(parseInstallArgs(["install", "--nope"]).kind).toBe("error");
  expect(parseInstallArgs(["install", "--scope", "everywhere"]).kind).toBe(
    "error",
  );
  expect(parseInstallArgs(["install", "--agent"]).kind).toBe("error");
});
