import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DisplayPresentation, DisplayShape } from "@yunari/renderer-core";
import { DEVICE_ID_PATTERN } from "./devices.js";
import {
  displayShape,
  normalizePresentation,
  snapRotation,
  storedRotation,
  wholeDegrees,
} from "./display-presentation.js";

/**
 * The displays this host knows about: the identity a screen is given, and the
 * credential that proves it is that screen.
 *
 * A display's *id* is minted once and never moves, because everything else —
 * which theme it holds, what it was told to show — is keyed by it. Its *label*
 * is what a person edits, and renaming one is not a re-identification.
 *
 * The file is `display-clients.json`, not `displays.json`: `display.ts` already
 * owns `display.json` in this same directory for how readings are displayed,
 * and two files one character apart with different owners is a defect waiting
 * for a tired reader.
 */

/** The display this machine is. Minted, never paired. */
export const LOCAL_DISPLAY_ID = "this-pc";
/** The display an unpaired client is served as. Never minted. */
export const DEFAULT_DISPLAY = "default";

export type DisplayKind = "paired" | "local" | "panel";

/**
 * A local display already holds the monitor this record would claim.
 *
 * A type rather than a message, because the route has to *answer* it: a second
 * record for one screen is not a body the store would not read (400) but the
 * request conflicting with what this host holds (409), and the two are told
 * apart here rather than by matching on words.
 */
export class MonitorAlreadyHeldError extends Error {}

/**
 * A panel display already holds the hardware this record would claim.
 *
 * A type for the same reason as `MonitorAlreadyHeldError`: two records for one
 * panel are two runners on one interface, which is a conflict with what the
 * host holds (409) rather than a body it would not read (400).
 */
export class PanelAlreadyHeldError extends Error {}

/**
 * What identifies the physical screen behind a local display.
 *
 * A monitor has no name a person would recognise, so both halves are hints: the
 * id is the identity, and this is only what to call it and how to recognise it
 * again after a reboot.
 */
export interface MonitorHint {
  readonly serial?: string;
  readonly deviceName: string;
}

/**
 * What identifies a physical USB panel, for a record and for re-finding it
 * after a reboot.
 *
 * A bus address moves when a cable does; the IDs and the serial do not. The
 * model is carried rather than derived, because a record is read on a machine
 * whose table may have gained or lost one, and a record that could not say
 * which panel it is would be a wall screen nobody could ask about.
 */
export interface PanelHardware {
  readonly vendorId: number;
  readonly productId: number;
  /** The panel model's own id from the host's table, e.g. `lianli-9-2`. */
  readonly model: string;
  /** Empty when the firmware reports none — the IDs are then all there is. */
  readonly serial?: string;
}

/** What a panel is identified by: the fields `samePanel` compares, so a hint
 *  enumerated from hardware can be compared without inventing a model. */
export interface PanelIdentity {
  readonly vendorId: number;
  readonly productId: number;
  readonly serial?: string;
}

export interface DisplayRecord {
  readonly id: string;
  readonly label: string;
  readonly kind: DisplayKind;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** Absent for a local display: it is this machine, so it has nothing to prove. */
  readonly tokenHash?: string;
  readonly monitor?: MonitorHint;
  /** A USB panel's hardware identity. Absent for every other kind. */
  readonly panel?: PanelHardware;
  /** The glass: a rectangular panel or a round one. Never absent in a record. */
  readonly shape: DisplayShape;
  /** Whole degrees clockwise; omitted when upright, which every reader answers as 0. */
  readonly rotation?: number;
}

/** The things a person edits. None may touch the id. */
export interface DisplayPatch {
  readonly label?: string;
  readonly shape?: DisplayShape;
  readonly rotation?: number;
}

export interface DisplayStore {
  list(): Promise<readonly DisplayRecord[]>;
  /**
   * The list, and whether the file behind it could be read.
   *
   * `list()` fails closed to an empty list, which is right for a consumer that
   * only needs identities: the display a request names is not there either way.
   * A settings surface needs the second half — an unreadable file and an empty
   * one look identical on screen and mean opposite things, and every write will
   * refuse while the file stays unreadable.
   */
  state(): Promise<DisplayState>;
  create(
    label: string,
    token: string,
    presentation?: DisplayPresentation,
  ): Promise<DisplayRecord>;
  createLocal(
    label: string,
    monitor: MonitorHint,
    presentation?: DisplayPresentation,
  ): Promise<DisplayRecord>;
  createPanel(
    label: string,
    panel: PanelHardware,
    presentation?: DisplayPresentation,
  ): Promise<DisplayRecord>;
  find(id: string): Promise<DisplayRecord | undefined>;
  authenticate(token: string): Promise<DisplayRecord | undefined>;
  rotate(id: string, token: string): Promise<DisplayRecord | undefined>;
  update(id: string, patch: DisplayPatch): Promise<DisplayRecord | undefined>;
  touch(id: string, at: string): Promise<void>;
  remove(id: string): Promise<boolean>;
}

const FILE = "display-clients.json";
const MAX_LABEL_LENGTH = 64;
const MAX_ID_LENGTH = 64;

/**
 * The name a person sees and edits: trimmed, and refused if that leaves nothing
 * or leaves too much.
 *
 * Deliberately **not** the slug rule. `Living Room (TV)` is a name someone may
 * have, and refusing it because it holds a space and a bracket would be a rule
 * nobody could act on — the id was already minted from a slug when the display
 * was created.
 */
export function normalizeLabel(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("A display label must be a string.");
  }

  const label = input.trim();

  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) {
    throw new Error(
      `A display label must be 1 to ${MAX_LABEL_LENGTH} characters, not ${label.length}.`,
    );
  }

  return label;
}

/**
 * How a credential is stored. Here rather than at each call site, so nothing
 * else in the tree decides how a token becomes a hash.
 *
 * A token of 32 CSPRNG bytes has no dictionary to attack, so the hash's job is
 * narrower than usual: reading the file — a backup, a synced folder, a
 * screenshot — yields a list of displays rather than a set of usable
 * credentials.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * The id a label slugs to, with a suffix when the slug is already taken.
 *
 * Pure, so its refusals are unit-testable: a label of punctuation slugs to
 * nothing, and an id that starts with a dash is one `DEVICE_ID_PATTERN` would
 * drop on the next read — better to refuse it here than to write a record that
 * disappears.
 */
export function displayIdFrom(label: string, suffix: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const tail = suffix.length === 0 ? "" : `-${suffix}`;
  // The suffix wins the room it needs: an id whose suffix was truncated would
  // not be the id the caller asked for.
  const room = Math.max(MAX_ID_LENGTH - tail.length, 0);
  const id = `${slug.slice(0, room).replace(/-+$/g, "")}${tail}`;

  if (id.length === 0 || !DEVICE_ID_PATTERN.test(id)) {
    throw new Error(`"${label}" yields no usable id.`);
  }

  return id;
}

/**
 * The id a new display's label would be minted from, refused with the store's own
 * words when it cannot be one: an empty or over-long label, one that slugs to
 * nothing, or one that slugs to a reserved id.
 *
 * Exported because the pairing route has to *answer* a label the store would
 * refuse rather than let it throw — a rejected request handler is an uncaught
 * exception in Node, so a refused label would take the listener down with it.
 * A second copy of these three rules in the route would be a second thing to keep
 * true.
 */
export function mintedDisplayId(label: unknown): string {
  const id = displayIdFrom(normalizeLabel(label), "");

  if (id === LOCAL_DISPLAY_ID || id === DEFAULT_DISPLAY) {
    throw new Error(`"${id}" is a reserved display id.`);
  }

  return id;
}

/**
 * A serial that is blank is no serial: `MonitorHint.serial` is optional, and a
 * hint carrying `""` matches nothing, so the display would read as detached for
 * ever — `vg-616`'s class, a value where absence was meant. One owner, because
 * the reader below and the probe's own `hintFor` must agree about it.
 */
export function reportedSerial(serial: string | undefined): string | undefined {
  const trimmed = serial?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * A monitor hint, or nothing when the value carries no usable device name.
 *
 * Exported for the route that adds a local display: a hint the file's own reader
 * would drop is a record that disappears on the next read, so the request is
 * refused rather than written — and a second copy of this rule in the route
 * would be a second thing to keep true.
 */
export function normalizeMonitor(input: unknown): MonitorHint | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const deviceName = raw["deviceName"];

  if (typeof deviceName !== "string" || deviceName.length === 0) {
    return undefined;
  }

  const rawSerial = raw["serial"];
  const serial = reportedSerial(
    typeof rawSerial === "string" ? rawSerial : undefined,
  );

  return {
    deviceName,
    ...(serial === undefined ? {} : { serial }),
  };
}

/**
 * Whether two stored hints name the same screen, by the rule `isAttached`
 * applies to a live monitor: the serial is the identity when both ends have
 * one — a device name moves when cables do — and the device name is all either
 * end has otherwise. A blank serial is no serial, or two hints the reader would
 * have normalised apart would compare equal.
 */
function sameHint(first: MonitorHint, second: MonitorHint): boolean {
  const serial = reportedSerial(first.serial);
  const other = reportedSerial(second.serial);

  return serial !== undefined && other !== undefined
    ? serial === other
    : first.deviceName === second.deviceName;
}

/**
 * A panel's identity, or nothing when either id is unusable.
 *
 * The model is not part of it: the family table owns which model an id is, so
 * the route that adds a panel takes the identity and fills the model itself.
 * A record read back needs `normalizePanel`, which requires both.
 */
export function normalizePanelIdentity(
  input: unknown,
): PanelIdentity | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const vendorId = raw["vendorId"];
  const productId = raw["productId"];

  if (!isUsbId(vendorId) || !isUsbId(productId)) return undefined;

  const rawSerial = raw["serial"];
  const serial = reportedSerial(
    typeof rawSerial === "string" ? rawSerial : undefined,
  );

  return { vendorId, productId, ...(serial === undefined ? {} : { serial }) };
}

/**
 * A panel's hardware identity, or nothing when any half is unusable.
 *
 * Refused rather than repaired: an id of zero, a model name nothing knows and a
 * fractional or out-of-range id are all values where absence was meant, and a
 * record carrying one would be a panel the manager cannot open and cannot
 * explain (`vg-616`'s class).
 */
export function normalizePanel(input: unknown): PanelHardware | undefined {
  const identity = normalizePanelIdentity(input);

  if (identity === undefined) return undefined;

  const model = (input as Record<string, unknown>)["model"];

  if (typeof model !== "string" || model.length === 0) return undefined;

  return { ...identity, model };
}

/** A USB id is a whole number in 16 bits, and 0 is no id at all. */
function isUsbId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 0xffff
  );
}

/** Whether two hardware identities name the same panel, by the monitor rule:
 *  the serial is the identity when both ends have one — a panel moved to another
 *  port keeps its serial — and the IDs are all either end has otherwise.
 *
 *  Exported because the route that lists attached panels needs the *same*
 *  answer: a looser comparison there offers a panel whose only outcome is the
 *  refusal below. The parameter is the three fields it reads, not
 *  `PanelHardware`, because a hint from the family table has no model yet. */
export function samePanel(
  first: PanelIdentity,
  second: PanelIdentity,
): boolean {
  const serial = reportedSerial(first.serial);
  const other = reportedSerial(second.serial);

  if (serial !== undefined && other !== undefined) return serial === other;

  return (
    first.vendorId === second.vendorId && first.productId === second.productId
  );
}

/**
 * Keeps only records something else will accept. A hand-edited file must not be
 * able to introduce a display nothing else accepts, so an unusable id, a label
 * that is not a name, an unknown kind or a duplicate id drops the record.
 */
function normalizeRecord(input: unknown): DisplayRecord | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as Record<string, unknown>;

  const id = raw["id"];
  if (typeof id !== "string" || !DEVICE_ID_PATTERN.test(id)) return undefined;

  const rawLabel = raw["label"];
  if (typeof rawLabel !== "string") return undefined;
  const label = rawLabel.trim();
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) return undefined;

  const kind = raw["kind"];
  if (kind !== "paired" && kind !== "local" && kind !== "panel")
    return undefined;

  const tokenHash = raw["tokenHash"];
  // A paired record with no hash is a display nothing can authenticate as; a
  // local or panel record carrying one is a credentialless display pretending
  // otherwise.
  if (kind === "paired" && typeof tokenHash !== "string") return undefined;
  if (kind !== "paired" && tokenHash !== undefined) return undefined;

  const createdAt = raw["createdAt"];
  const lastSeenAt = raw["lastSeenAt"];
  if (typeof createdAt !== "string" || typeof lastSeenAt !== "string") {
    return undefined;
  }

  const monitor = normalizeMonitor(raw["monitor"]);
  // A panel's hardware identity is what finds it again, so a panel record with
  // no usable one is a record nothing can drive and is dropped rather than
  // kept as a screen that never appears.
  const panel = normalizePanel(raw["panel"]);
  if (kind === "panel" && panel === undefined) return undefined;
  if (kind !== "panel" && panel !== undefined) return undefined;

  // An unreadable shape is a rectangular screen rather than a dropped record:
  // the display then plays upright. A rotation the shape cannot hold is
  // dropped with it.
  const shape: DisplayShape = raw["shape"] === "circle" ? "circle" : "rect";
  const rotation = storedRotation(shape, raw["rotation"]);

  return {
    id,
    label,
    kind,
    createdAt,
    lastSeenAt,
    shape,
    ...(rotation === undefined ? {} : { rotation }),
    ...(typeof tokenHash === "string" ? { tokenHash } : {}),
    ...(monitor !== undefined ? { monitor } : {}),
    ...(panel !== undefined ? { panel } : {}),
  };
}

interface DisplayFileRead {
  /** What the file holds; empty when it could not be read, so reads fail closed. */
  readonly displays: DisplayRecord[];
  /**
   * Present when the file is there and unusable. A reader may report no
   * displays, but a mutator must not write back: the file is the owner's only
   * copy of their displays and credentials.
   */
  readonly failure?: string;
}

/** What a settings surface reads: the records, and whether the file could be
 *  read at all. The failure's own words stay in the host; a page names the file
 *  and the repair rather than an operating-system string. */
export interface DisplayState {
  readonly displays: readonly DisplayRecord[];
  readonly unreadable: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readDisplays(file: string): Promise<DisplayFileRead> {
  let raw: string;

  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    // A missing file is a fresh install, not a failure. Anything else — a
    // permission, a directory, a bad sector — is a file we cannot account for.
    if (isMissing(error)) return { displays: [] };
    return { displays: [], failure: describe(error) };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A present file that does not parse is not an empty one.
    return { displays: [], failure: describe(error) };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { displays: [], failure: "the file does not hold an object" };
  }

  const rawDisplays = (parsed as Record<string, unknown>)["displays"];
  if (rawDisplays !== undefined && !Array.isArray(rawDisplays)) {
    return { displays: [], failure: '"displays" is not a list' };
  }

  const displays: DisplayRecord[] = [];
  const seen = new Set<string>();

  for (const entry of rawDisplays ?? []) {
    const record = normalizeRecord(entry);
    if (record === undefined || seen.has(record.id)) continue;
    seen.add(record.id);
    displays.push(record);
  }

  return { displays };
}

/**
 * A patch with both fields checked, refused with the store's own words when
 * either cannot be one.
 *
 * Exported for the same reason `mintedDisplayId` is: the route has to *answer* a
 * patch the store would refuse rather than let it throw — a rejected request
 * handler is an uncaught exception in Node, and the wrapper's 500 tells a caller
 * who sent an impossible label that the host failed. A second copy of either
 * rule in the route would be a second thing to keep true, so both rules are
 * asked here, in one call.
 */
export function normalizePatch(patch: DisplayPatch): DisplayPatch {
  const label =
    patch.label === undefined ? undefined : normalizeLabel(patch.label);
  // Only membership and a whole angle here: this has no record, so the patch's
  // own shape deciding the rule is `update`'s job once the final shape is known.
  const shape =
    patch.shape === undefined ? undefined : displayShape(patch.shape);
  const rotation =
    patch.rotation === undefined ? undefined : wholeDegrees(patch.rotation);

  return {
    ...(label === undefined ? {} : { label }),
    ...(shape === undefined ? {} : { shape }),
    ...(rotation === undefined ? {} : { rotation }),
  };
}

/**
 * How close two sightings have to be for the second to be the same one.
 *
 * The store's own number, because the store owns the file and the cost of
 * rewriting it. It is chosen against the launcher's fifteen-second liveness
 * window, sampled every fifteen seconds: the oldest stamp the file can hold
 * while a poll is skipped is this plus the player's two-second interval, which
 * is inside that window, so a sighting cannot go missing because a write was
 * skipped.
 *
 * **The comparison is absolute, not forward.** A stamp *older* than the stored
 * one is still written: the launcher tells a window that is up from one a
 * killed host left behind by `lastSeenAt !== createdAt`, so dropping a sighting
 * for being out of order would report a live window as absent.
 */
const TOUCH_INTERVAL_MS = 5_000;

function withinTouchInterval(stored: string, offered: string): boolean {
  // An unparseable stamp is not a window — `NaN` fails every comparison — so
  // the caller's write happens, which is what this store did before the window.
  return Math.abs(Date.parse(offered) - Date.parse(stored)) < TOUCH_INTERVAL_MS;
}

export function createDisplayStore(
  directory: string,
  options: {
    readonly now?: () => number;
    readonly randomSuffix?: () => string;
  } = {},
): DisplayStore {
  const file = path.join(directory, FILE);
  const now = options.now ?? Date.now;
  const randomSuffix =
    options.randomSuffix ?? (() => randomBytes(2).toString("hex"));

  const save = async (displays: readonly DisplayRecord[]): Promise<void> => {
    await mkdir(directory, { recursive: true });
    // Written beside the target and renamed over it, so a crash mid-write
    // leaves the previous file rather than a truncated one.
    const temporary = path.join(
      directory,
      `${FILE}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeFile(
        temporary,
        `${JSON.stringify({ displays }, null, 2)}\n`,
        "utf8",
      );
      await rename(temporary, file);
    } catch (error) {
      // A failed write must not leave its temp file behind. Removing it is
      // best effort: the write failure is the error worth reporting.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  /**
   * The displays, or a refusal. Every mutator is read-modify-write, so writing
   * over a file it could not read would persist that failure as emptiness.
   */
  const readOrThrow = async (): Promise<DisplayRecord[]> => {
    const { displays, failure } = await readDisplays(file);

    if (failure !== undefined) {
      throw new Error(
        `${file} could not be read, so it was not written: ${failure}`,
      );
    }

    return displays;
  };

  /**
   * One write at a time.
   *
   * Every mutator is read-modify-write over the whole file, so two overlapping
   * ones lose the earlier: a removal landing between a `touch`'s read and its
   * save is undone, and the display — with its credential — comes back, which is
   * a revocation that did not happen. The chain is the whole of the
   * serialization; a link that rejects must not break the ones behind it.
   *
   * Nothing nests: `add` is private and lock-free, so each mutator takes the
   * lock exactly once.
   */
  let writing: Promise<unknown> = Promise.resolve();
  const writeExclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work, work);
    writing = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const add = async (
    label: string,
    fields: {
      readonly kind: DisplayKind;
      readonly tokenHash?: string;
      readonly monitor?: MonitorHint;
      readonly panel?: PanelHardware;
    },
    presentation: DisplayPresentation,
  ): Promise<DisplayRecord> => {
    const name = normalizeLabel(label);
    const displays = await readOrThrow();
    const taken = new Set(displays.map((display) => display.id));
    let id = mintedDisplayId(name);

    if (taken.has(id)) {
      id = displayIdFrom(name, randomSuffix());
      if (taken.has(id)) {
        throw new Error(`No unused id is left for "${name}".`);
      }
    }

    const at = new Date(now()).toISOString();
    const record: DisplayRecord = {
      id,
      label: name,
      createdAt: at,
      lastSeenAt: at,
      shape: presentation.shape,
      ...(presentation.rotation === undefined
        ? {}
        : { rotation: presentation.rotation }),
      ...fields,
    };

    await save([...displays, record]);
    return record;
  };

  return {
    async list(): Promise<readonly DisplayRecord[]> {
      return (await readDisplays(file)).displays;
    },

    async state(): Promise<DisplayState> {
      const { displays, failure } = await readDisplays(file);
      return { displays, unreadable: failure !== undefined };
    },

    create(label, token, presentation): Promise<DisplayRecord> {
      return writeExclusively(() =>
        add(
          label,
          { kind: "paired", tokenHash: hashToken(token) },
          normalizePresentation(presentation?.shape, presentation?.rotation),
        ),
      );
    },

    /**
     * A local display for a monitor, refused when one already holds it.
     *
     * The hint *is* a local display's identity: two records holding one match
     * the same attached monitor, so the second has no window the first does not
     * already have, and the launcher would open two fullscreen windows on one
     * screen — one hidden behind the other and both polling. Refusing the write
     * is the repair; keying the launcher by hint instead would leave the second
     * record in the list for ever with no window and no explanation.
     */
    createLocal(label, monitor, presentation): Promise<DisplayRecord> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const held = displays.some(
          (record) =>
            record.kind === "local" &&
            record.monitor !== undefined &&
            sameHint(record.monitor, monitor),
        );

        if (held) {
          throw new MonitorAlreadyHeldError(
            "A local display already holds that monitor.",
          );
        }

        return add(
          label,
          { kind: "local", monitor },
          normalizePresentation(presentation?.shape, presentation?.rotation),
        );
      });
    },

    /**
     * A USB panel, refused when one already holds that piece of hardware.
     *
     * The same reasoning as `createLocal`, and the same failure: two records for
     * one panel are two runners claiming one interface, so one loses every frame
     * and neither explains why. The serial is the identity when the firmware
     * reports one, because a panel plugged into a different port is the same
     * panel; the IDs are all there is otherwise.
     */
    createPanel(label, panel, presentation): Promise<DisplayRecord> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const held = displays.some(
          (record) =>
            record.kind === "panel" &&
            record.panel !== undefined &&
            samePanel(record.panel, panel),
        );

        if (held) {
          throw new PanelAlreadyHeldError(
            "A panel display already holds that device.",
          );
        }

        return add(
          label,
          { kind: "panel", panel },
          normalizePresentation(presentation?.shape, presentation?.rotation),
        );
      });
    },

    async find(id): Promise<DisplayRecord | undefined> {
      return (await readDisplays(file)).displays.find(
        (record) => record.id === id,
      );
    },

    async authenticate(token): Promise<DisplayRecord | undefined> {
      // An empty string is no credential, and hashing it would hand a display
      // created with one a way in.
      if (token.length === 0) return undefined;

      const hash = hashToken(token);
      return (await readDisplays(file)).displays.find(
        (record) => record.tokenHash === hash,
      );
    },

    rotate(id, token): Promise<DisplayRecord | undefined> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const index = displays.findIndex((record) => record.id === id);
        const found = displays[index];

        // A local display has no credential to replace, and giving it one would
        // write a record the next read drops.
        if (found === undefined || found.kind !== "paired") return undefined;

        const record: DisplayRecord = {
          ...found,
          tokenHash: hashToken(token),
        };
        displays[index] = record;
        await save(displays);
        return record;
      });
    },

    update(id, patch): Promise<DisplayRecord | undefined> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const index = displays.findIndex((record) => record.id === id);
        const found = displays[index];

        if (found === undefined) return undefined;

        const label =
          patch.label === undefined ? found.label : normalizeLabel(patch.label);

        // The patch's fields are applied as one: the final shape decides the
        // rule the final rotation must satisfy. A new shape with no angle named
        // snaps the stored angle into the new rule — a round screen's free angle
        // cannot survive becoming rectangular, and snapping names that.
        const shape = patch.shape ?? found.shape;
        const rotation =
          patch.rotation ??
          (patch.shape !== undefined && patch.shape !== found.shape
            ? snapRotation(shape, found.rotation ?? 0)
            : (found.rotation ?? 0));
        const presentation = normalizePresentation(shape, rotation);

        // The id, the creation time and the monitor are not patchable: everything
        // else is keyed by the id, so a rename that moved it would orphan them.
        // `rotation` is taken out of the spread because omitting it must clear
        // the stored one rather than leave the found record's angle behind.
        const { rotation: _old, ...rest } = found;
        const record: DisplayRecord = {
          ...rest,
          label,
          shape: presentation.shape,
          ...(presentation.rotation === undefined
            ? {}
            : { rotation: presentation.rotation }),
        };

        displays[index] = record;
        await save(displays);
        return record;
      });
    },

    touch(id, at): Promise<void> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const index = displays.findIndex((record) => record.id === id);
        const found = displays[index];

        if (found === undefined) return;
        // A sighting that has barely moved is the same sighting. A display
        // polls every two seconds, and a `touch` per poll is a whole-file
        // rewrite for a value nothing reads that finely — the launcher reads it
        // against a fifteen-second window sampled every fifteen seconds, so a
        // stamp up to `TOUCH_INTERVAL_MS` old cannot change its answer.
        if (withinTouchInterval(found.lastSeenAt, at)) return;

        displays[index] = { ...found, lastSeenAt: at };
        await save(displays);
      });
    },

    remove(id): Promise<boolean> {
      return writeExclusively(async () => {
        const displays = await readOrThrow();
        const remaining = displays.filter((record) => record.id !== id);

        if (remaining.length === displays.length) return false;

        await save(remaining);
        return true;
      });
    },
  };
}
