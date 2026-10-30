import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * One JSON file in the settings folder, read and written as a whole.
 *
 * Every store beside this module is read-modify-write over one file, and two
 * things go wrong when that overlaps. A reader can land inside `writeFile`,
 * which truncates before it writes, and see an empty or half-written file; and
 * two mutators can both read the old contents and the later save drops the
 * earlier one's entry. So writes go to a temporary file and are renamed over
 * the target, and every read or write queues behind the one before it.
 *
 * The queue also keeps Windows honest: a rename over a file another handle
 * holds open fails with EPERM instead of waiting, so a reader must never overlap
 * a writer.
 */

/** A mutation returns the value to store and whatever its caller needs. */
export type MutateResult<T, R> = { readonly next: T; readonly result: R };

export interface JsonFile<T> {
  /** The stored value, or `empty()` when there is no file or it cannot be read. */
  read(): Promise<T>;
  /** Replace the whole value. */
  write(value: T): Promise<void>;
  /**
   * Read-modify-write as one queued step.
   *
   * A file that is present but unusable is refused rather than replaced: that
   * is the write a corrupt file must not receive.
   */
  mutate<R>(
    work: (current: T) => Promise<MutateResult<T, R>> | MutateResult<T, R>,
  ): Promise<R>;
}

/** A missing file is a fresh install; anything else is a file we cannot account for. */
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createJsonFile<T>(
  directory: string,
  file: string,
  options: {
    /** Turn parsed JSON into the stored value; may throw to refuse a bad shape. */
    readonly normalize: (parsed: unknown) => T;
    /** The value of a missing file: nothing has been stored yet. */
    readonly empty: () => T;
  },
): JsonFile<T> {
  const target = path.join(directory, file);

  let queue: Promise<unknown> = Promise.resolve();
  const exclusively = <R>(work: () => Promise<R>): Promise<R> => {
    const next = queue.then(work, work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /** Parsed contents, or undefined when the file is not there. Throws otherwise. */
  const parse = async (): Promise<unknown> => {
    let raw: string;

    try {
      raw = await readFile(target, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new Error(
        `${target} could not be read, so it was not written: ${reason(error)}`,
      );
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `${target} could not be read, so it was not written: ${reason(error)}`,
      );
    }
  };

  const parseExisting = async (): Promise<T | undefined> => {
    const parsed = await parse();
    return parsed === undefined ? undefined : options.normalize(parsed);
  };

  return {
    async read() {
      return exclusively(async () => {
        try {
          return (await parseExisting()) ?? options.empty();
        } catch {
          // Reads fail closed to nothing stored: never fail a poll or a page
          // over a hand-edited file. Mutators refuse instead, below.
          return options.empty();
        }
      });
    },

    async write(value) {
      await exclusively(async () => {
        await mkdir(directory, { recursive: true });
        const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;

        try {
          await writeFile(
            temporary,
            `${JSON.stringify(value, null, 2)}\n`,
            "utf8",
          );
          await rename(temporary, target);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }
      });
    },

    async mutate(work) {
      return exclusively(async () => {
        const current = (await parseExisting()) ?? options.empty();
        const { next, result } = await work(current);
        await mkdir(directory, { recursive: true });
        const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;

        try {
          await writeFile(
            temporary,
            `${JSON.stringify(next, null, 2)}\n`,
            "utf8",
          );
          await rename(temporary, target);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }

        return result;
      });
    },
  };
}
