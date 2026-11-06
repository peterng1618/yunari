/** Bounds keep a hostile manifest small enough to validate in one pass. */
export const MAX_CAPABILITIES = 32;
export const MAX_CONTRIBUTIONS = 64;
export const MAX_NETWORK_HOSTS = 16;

export const MAX_IDENTIFIER = 64;
export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_VERSION = 128;
export const MAX_ENTRY_PATH = 200;
export const MAX_USB_ID = 0xffff;

export const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;

/** Whether a name is a Windows device name, case-insensitive and regardless of
 *  an extension. The plugin package path check and manifest identifiers share
 *  this rule: both become path segments on the host. */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED.test((name.split(".")[0] ?? "").toUpperCase());
}

export type Check<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export type ObjectValue = Readonly<Record<string, unknown>>;

export function refuse(reason: string): {
  readonly ok: false;
  readonly reason: string;
} {
  return { ok: false, reason };
}

export function isRecord(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every object in the manifest is closed: a key this ABI does not know is a
 *  newer contribution or a typo, and loading it would silently drop behaviour. */
export function checkKeys(
  value: ObjectValue,
  allowed: readonly string[],
  subject: string,
): string | undefined {
  const known = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !known.has(key));
  if (unknown === undefined) return undefined;
  return subject === ""
    ? `Unknown manifest key ${JSON.stringify(unknown)}.`
    : `${subject} has unknown key ${JSON.stringify(unknown)}.`;
}

export function readString(
  value: unknown,
  subject: string,
  max: number,
): Check<string> {
  if (typeof value !== "string") return refuse(`${subject} must be a string.`);
  if (value.trim() === "") return refuse(`${subject} must not be empty.`);
  if (value.length > max)
    return refuse(`${subject} must be at most ${max} characters.`);
  return { ok: true, value };
}

export function readIdentifier(
  value: unknown,
  subject: string,
  reservedPrefix: string | undefined,
): Check<string> {
  const string = readString(value, subject, MAX_IDENTIFIER);
  if (!string.ok) return string;
  if (!IDENTIFIER_PATTERN.test(string.value))
    return refuse(
      `${subject} ${JSON.stringify(string.value)} must be kebab-case.`,
    );
  if (isWindowsReservedName(string.value))
    return refuse(
      `${subject} ${JSON.stringify(string.value)} is a reserved device name.`,
    );
  if (reservedPrefix !== undefined && string.value.startsWith(reservedPrefix))
    return refuse(`${subject} ${JSON.stringify(string.value)} is reserved.`);
  return string;
}

export function readUsbId(value: unknown, subject: string): Check<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return refuse(`${subject} must be a non-negative integer.`);
  if (value > MAX_USB_ID)
    return refuse(`${subject} must be a 16-bit USB id (0-65535).`);
  return { ok: true, value };
}

export function readPositiveNumber(
  value: unknown,
  subject: string,
): Check<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return refuse(`${subject} must be a positive number.`);
  return { ok: true, value };
}

export function readRelativePath(
  value: unknown,
  subject: string,
): Check<string> {
  const path = readString(value, subject, MAX_ENTRY_PATH);
  if (!path.ok) return path;
  if (
    path.value.startsWith("/") ||
    path.value.startsWith("\\") ||
    path.value.includes("\\") ||
    /^[A-Za-z]:/.test(path.value)
  )
    return refuse(`${subject} must be a relative package path.`);
  const segments = path.value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return refuse(`${subject} must stay inside the package.`);
  return path;
}

export function readStringList(
  value: unknown,
  subject: string,
  maxEntries: number,
): Check<readonly string[]> {
  if (!Array.isArray(value)) return refuse(`${subject} must be an array.`);
  if (value.length > maxEntries)
    return refuse(`${subject} carries at most ${maxEntries} entries.`);
  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    const string = readString(entry, `${subject}[${index}]`, MAX_NAME);
    if (!string.ok) return string;
    strings.push(string.value);
  }
  return { ok: true, value: strings };
}

export function readList<T>(
  value: unknown,
  subject: string,
  readEntry: (entry: unknown, subject: string) => Check<T>,
): Check<readonly T[]> {
  if (!Array.isArray(value)) return refuse(`${subject} must be an array.`);
  if (value.length > MAX_CONTRIBUTIONS)
    return refuse(`${subject} carries at most ${MAX_CONTRIBUTIONS} entries.`);
  const entries: T[] = [];
  for (const [index, entry] of value.entries()) {
    const read = readEntry(entry, `${subject}[${index}]`);
    if (!read.ok) return read;
    entries.push(read.value);
  }
  return { ok: true, value: entries };
}

export function readOptionalList<T>(
  value: unknown,
  subject: string,
  readEntry: (entry: unknown, subject: string) => Check<T>,
): Check<readonly T[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return readList(value, subject, readEntry);
}

export function readRecord(
  value: unknown,
  subject: string,
): Check<ObjectValue> {
  if (!isRecord(value)) return refuse(`${subject} must be an object.`);
  return { ok: true, value: { ...value } };
}
