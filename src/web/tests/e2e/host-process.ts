import type { ChildProcess } from "node:child_process";

/** What a host has left to say once it is gone, or `undefined` while it lives. */
function ending(child: ChildProcess): string | undefined {
  if (child.exitCode !== null) return `exit ${child.exitCode}`;
  return child.signalCode ?? undefined;
}

/**
 * Ends a real host a spec started, and waits for its port to be free.
 *
 * **The wait is bounded.** `kill()` does not promise an `exit` event: a child
 * that already died fired it before this listener existed, and one that
 * ignores the signal fires nothing. An unbounded `once("exit")` turns either
 * case into a teardown that holds the test open until Playwright's budget runs
 * out, which reports the hook rather than the cause.
 *
 * Ending the child is not merely tidy: the next test binds the same port, and
 * a listener that has not gone yet answers the health poll for a host that is
 * still starting.
 */
export async function stopHost(
  child: ChildProcess,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (ending(child) === undefined) child.kill();

  const deadline = Date.now() + timeoutMs;
  while (ending(child) === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (ending(child) === undefined) {
    // A host that ignores the first signal still must not outlive the test.
    child.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
