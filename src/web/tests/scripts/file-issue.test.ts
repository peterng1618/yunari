import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import {
  buildIssue,
  machineDetails,
  repoFromRemote,
  resolveRepo,
} from "../../../../scripts/file-issue.mjs";

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/file-issue.mjs", import.meta.url),
);

it("reads a GitHub owner/name from either clone URL form", () => {
  expect(repoFromRemote("git@github.com:peterng1618/yunari.git")).toBe(
    "peterng1618/yunari",
  );
  expect(repoFromRemote("https://github.com/peterng1618/yunari.git")).toBe(
    "peterng1618/yunari",
  );
  expect(repoFromRemote("https://example.com/peterng1618/yunari.git")).toBe(
    undefined,
  );
});

it("falls back to the known repo when there is no origin", () => {
  expect(resolveRepo({ explicit: undefined, remote: undefined })).toBe(
    "peterng1618/yunari",
  );
  expect(
    resolveRepo({
      explicit: "someone/fork",
      remote: "git@github.com:other/repo.git",
    }),
  ).toBe("someone/fork");
});

it("writes the recap and provenance without inventing a cause", () => {
  const issue = buildIssue({
    kind: "bug",
    title: "Delete does nothing on a grouped child",
    recap: "A grouped child is not deleted when Delete is pressed.",
    context: { branch: "fix/crop", sha: "1acdbe75" },
  });

  expect(issue.labels).toEqual(["bug", "needs-triage"]);
  expect(issue.body).toContain("**What happens**");
  expect(issue.body).toContain("A grouped child is not deleted");
  expect(issue.body).toContain("**Source**\n\nReported by a user.");
  expect(issue.body).toContain("`fix/crop` at `1acdbe75`");
  expect(issue.body).not.toContain("**Why**");
  expect(issue.body).not.toContain("**Next pickup action**");
  expect(issue.body).not.toContain("**Size");
});

it("keeps the request body to the recap unless journey and done are given", () => {
  const issue = buildIssue({
    kind: "request",
    title: "Show the binding on a gauge label",
    recap: "A bound run shows '-' without naming the binding.",
  });

  expect(issue.labels).toEqual(["needs-triage"]);
  expect(issue.body).toContain("**What**");
  expect(issue.body).toContain("**Source**\n\nReported by a user.");
  expect(issue.body).not.toContain("Which journey");
  expect(issue.body).not.toContain('What "done"');
  expect(issue.body).not.toContain("**Kind**");
});

it("records the agent as the source when asked", () => {
  const issue = buildIssue({
    kind: "request",
    title: "A finding",
    recap: "The preview is empty.",
    source: "agent",
  });

  expect(issue.body).toContain("**Source**\n\nFound by the agent.");
});

it("includes journey and done when the agent supplied them", () => {
  const issue = buildIssue({
    kind: "request",
    title: "Show the binding on a gauge label",
    recap: "A bound run shows '-' without naming the binding.",
    journey: "Binding a run in the editor and reading it on the canvas.",
    done: "The label names its binding.",
  });

  expect(issue.body).toContain("**Which journey it breaks or improves**");
  expect(issue.body).toContain("Binding a run in the editor");
  expect(issue.body).toContain('**What "done" would look like**');
  expect(issue.body).toContain("The label names its binding.");
});

it("rejects a multi-line title", () => {
  expect(() => buildIssue({ title: "first\nsecond", recap: "text" })).toThrow(
    "one line",
  );
});

it("recognises a local path, home path and private address", () => {
  expect(
    machineDetails("C:\\Users\\peter\\orca\\workspaces\\yunari", []),
  ).not.toEqual([]);
  expect(machineDetails("/home/peter/yunari", [])).not.toEqual([]);
  expect(machineDetails("the host at 192.168.1.20", [])).not.toEqual([]);
  expect(machineDetails("the file <repo>/src/web/x.ts", [])).toEqual([]);
});

it("recognises this machine's own name", () => {
  expect(
    machineDetails("reproduced on buildbox-7", ["buildbox-7"]),
  ).not.toEqual([]);
});

it("rejects a recap carrying machine-specific detail", () => {
  expect(() =>
    buildIssue({
      title: "A symptom",
      recap: "Fails when the theme is loaded from C:\\Users\\peter\\themes.",
    }),
  ).toThrow("generalize before filing");
});

it("refuses the old raw-report flag", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--dry-run", "--title", "A symptom", "--report", "user words"],
    { encoding: "utf8" },
  );

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("recap the report in your own words");
});

it("refuses a missing attachment before touching gh", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--dry-run",
      "--title",
      "A symptom",
      "--recap",
      "A recap.",
      "--attach",
      "definitely-not-a-real-file.png",
    ],
    { encoding: "utf8" },
  );

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("attachment not found");
});

it("refuses a finished body and a recap together", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--dry-run",
      "--title",
      "A symptom",
      "--body",
      "A finished body.",
      "--recap",
      "A recap.",
    ],
    { encoding: "utf8" },
  );

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("alternatives");
});

it("dry-run prints the assembled issue without calling gh", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--dry-run",
      "--kind",
      "bug",
      "--title",
      "A reported symptom",
      "--recap",
      "The report's observable symptom.",
      "--label",
      "help wanted",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GH_REPO: "someone/else" },
    },
  );

  expect(result.status).toBe(0);
  const issue = JSON.parse(result.stdout);
  expect(issue.title).toBe("A reported symptom");
  expect(issue.labels).toEqual(["bug", "needs-triage", "help wanted"]);
  expect(issue.body).toContain("The report's observable symptom.");
  expect(issue.repo).not.toBe("someone/else");
  expect(issue.repo).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
});
