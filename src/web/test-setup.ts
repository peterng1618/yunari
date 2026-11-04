import { afterAll } from "vitest";

/**
 * Let React's own scheduler finish before a test file's environment goes away.
 *
 * React 19 commits some work through `setImmediate` (the scheduler's
 * `performWorkUntilDeadline`). A jsdom file can end between the commit and that
 * task, and the task then touches `window` after Vitest has torn the DOM down —
 * which Vitest reports as an unhandled `ReferenceError: window is not defined`
 * and exits red even though every test passed.
 *
 * `afterAll` runs inside the file's environment, before teardown, so yielding a
 * macrotask here gives the queued work its window. Two turns cover a task that
 * schedules its continuation.
 */
afterAll(async () => {
  for (let turn = 0; turn < 2; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
});
