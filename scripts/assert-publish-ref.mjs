#!/usr/bin/env node

/**
 * The publish tag guard as a function, so `publish.yml` can say it in one line
 * and the workflow checker can compare that line instead of parsing shell.
 *
 * `node scripts/assert-publish-ref.mjs` reads `GITHUB_EVENT_NAME`, `DRY_RUN`
 * and `GITHUB_REF`, prints the refusal to stderr and exits 1, or exits 0
 * silently.
 *
 * `DRY_RUN` is the workflow's own fail-closed serialisation: an absent value
 * is not `"true"`, so a missing variable refuses rather than publishes. A
 * missing or empty `GITHUB_EVENT_NAME` or `GITHUB_REF` also refuses: the
 * answer depends on both, so an unset local run must not read as a pass.
 *
 * Its cases live in `src/web/tests/scripts/assert-publish-ref.test.ts`.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The refusal message for a real manual dispatch off a tag, or `undefined`
 * when the combination may proceed.
 */
export function publishRefProblem({ eventName, dryRun, ref }) {
  if (
    typeof eventName !== "string" ||
    eventName === "" ||
    typeof ref !== "string" ||
    ref === ""
  ) {
    return "the guard needs GITHUB_EVENT_NAME and GITHUB_REF";
  }
  if (eventName !== "workflow_dispatch") return undefined;
  if (dryRun === "true") return undefined;
  if (ref.startsWith("refs/tags/v")) return undefined;
  return `a non-dry workflow_dispatch must run on a refs/tags/v* ref (got ${ref})`;
}

function main() {
  const problem = publishRefProblem({
    eventName: process.env.GITHUB_EVENT_NAME,
    dryRun: process.env.DRY_RUN,
    ref: process.env.GITHUB_REF,
  });
  if (problem === undefined) return 0;
  process.stderr.write(`${problem}\n`);
  return 1;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exit(main());
}
