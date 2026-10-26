import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { publishRefProblem } from "../../../../scripts/assert-publish-ref.mjs";

/**
 * The publish tag guard is a pure decision, so its six combinations are asked
 * directly rather than through a workflow fixture. Two CLI cases prove the
 * command `publish.yml` runs exits non-zero and explains itself.
 */

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/assert-publish-ref.mjs", import.meta.url),
);
const MISSING_INPUT = "the guard needs GITHUB_EVENT_NAME and GITHUB_REF";

it("refuses an absent event name", () => {
  expect(
    publishRefProblem({
      eventName: undefined,
      dryRun: "true",
      ref: "refs/heads/main",
    }),
  ).toBe(MISSING_INPUT);
});

it("refuses an empty event name", () => {
  expect(
    publishRefProblem({
      eventName: "",
      dryRun: "true",
      ref: "refs/heads/main",
    }),
  ).toBe(MISSING_INPUT);
});

it("refuses an absent ref", () => {
  expect(
    publishRefProblem({
      eventName: "release",
      dryRun: "false",
      ref: undefined,
    }),
  ).toBe(MISSING_INPUT);
});

it("refuses an empty ref", () => {
  expect(
    publishRefProblem({
      eventName: "release",
      dryRun: "false",
      ref: "",
    }),
  ).toBe(MISSING_INPUT);
});

it("refuses a non-dry manual dispatch off a tag", () => {
  expect(
    publishRefProblem({
      eventName: "workflow_dispatch",
      dryRun: "false",
      ref: "refs/heads/main",
    }),
  ).toBe(
    "a non-dry workflow_dispatch must run on a refs/tags/v* ref (got refs/heads/main)",
  );
});

it("passes a non-dry manual dispatch on a version tag", () => {
  expect(
    publishRefProblem({
      eventName: "workflow_dispatch",
      dryRun: "false",
      ref: "refs/tags/v1.2.3",
    }),
  ).toBeUndefined();
});

it("passes a dry-run manual dispatch off a tag", () => {
  expect(
    publishRefProblem({
      eventName: "workflow_dispatch",
      dryRun: "true",
      ref: "refs/heads/main",
    }),
  ).toBeUndefined();
});

it("passes the release event", () => {
  expect(
    publishRefProblem({
      eventName: "release",
      dryRun: "false",
      ref: "refs/heads/main",
    }),
  ).toBeUndefined();
});

it("refuses when DRY_RUN is absent, because absent is not true", () => {
  expect(
    publishRefProblem({
      eventName: "workflow_dispatch",
      dryRun: undefined,
      ref: "refs/heads/main",
    }),
  ).toBe(
    "a non-dry workflow_dispatch must run on a refs/tags/v* ref (got refs/heads/main)",
  );
});

it("refuses a tag that is not v-prefixed", () => {
  expect(
    publishRefProblem({
      eventName: "workflow_dispatch",
      dryRun: "false",
      ref: "refs/tags/1.2.3",
    }),
  ).toBe(
    "a non-dry workflow_dispatch must run on a refs/tags/v* ref (got refs/tags/1.2.3)",
  );
});

it("exits 1 and names the ref from the environment", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      DRY_RUN: "false",
      GITHUB_REF: "refs/heads/main",
    },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "a non-dry workflow_dispatch must run on a refs/tags/v* ref (got refs/heads/main)",
  );
});

it("exits 0 silently when the dispatch may proceed", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      DRY_RUN: "false",
      GITHUB_REF: "refs/tags/v1.2.3",
    },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

it("exits 1 and names the missing input when the environment is unset", () => {
  const env = { ...process.env };
  delete env.GITHUB_EVENT_NAME;
  delete env.DRY_RUN;
  delete env.GITHUB_REF;
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(MISSING_INPUT);
});
