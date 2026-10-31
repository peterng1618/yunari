#!/usr/bin/env node
/**
 * `npm run design:check`: every design check runs, whatever the previous one
 * answered.
 *
 * The steps used to be an npm `&&` chain, so a red token audit hid the
 * DESIGN.md citation half entirely — the check was invisible in exactly the run
 * that needed it (`vg-643`). A step's failure is remembered and the next step
 * still runs; the exit code is red if any step was.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESIGN_TOKENS = join(ROOT, "scripts", "design-tokens.mjs");
const DESIGN_MD = join(ROOT, "scripts", "design-md.mjs");

/** Runs every step, then answers whether any of them failed. */
export function run(steps) {
  let failed = false;
  for (const [command, ...args] of steps) {
    if (spawnSync(command, args, { stdio: "inherit" }).status !== 0) {
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

const STEPS = [
  [process.execPath, DESIGN_TOKENS],
  [process.execPath, DESIGN_MD, "--lint"],
  [process.execPath, DESIGN_MD, "--sync"],
];

/** A red step is reported, and the step after it still runs. */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "yunari-design-check-"));
  const marker = join(dir, "ran");
  const red = run([
    [process.execPath, "-e", "process.exit(3)"],
    [
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`,
    ],
  ]);
  const green = run([[process.execPath, "-e", "process.exit(0)"]]);
  const ok = red === 1 && green === 0 && existsSync(marker);
  rmSync(dir, { recursive: true, force: true });
  console.log(
    `${ok ? "ok  " : "FAIL"} a red step is reported and the one after it still runs`,
  );
  return ok ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
} else {
  process.exit(run(STEPS));
}
