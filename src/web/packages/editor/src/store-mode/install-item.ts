import { type HeldUpdate, isHeldUpdate } from "../components/held-update.js";
import type { CollectionInstallPress } from "../library-mode/collection-install.js";
import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

/** Where an install is handed over. The host's own route, named once. */
const INSTALL_PATH = "/api/store/install";

/** One chosen collection member's answer, as the host reports it after the
 *  install applied it. `reason` is present for a member that was already
 *  registered — a row the host merged rather than wrote. */
export interface CollectionMemberOutcome {
  readonly id: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export type InstallOutcome =
  | {
      readonly ok: true;
      /** Present for a collection; absent for a single item. */
      readonly members?: readonly CollectionMemberOutcome[];
    }
  /** `members` is present when a collection failed part-way: the host wrote
   *  some members and refused others, and the sheet names the refused ones. */
  | {
      readonly ok: false;
      readonly message: string;
      readonly members?: readonly CollectionMemberOutcome[];
    }
  /** The host read the package, held the update, and wrote nothing. `memberId`
   *  names the collection include whose notice the person saw, and `members`
   *  reports what earlier members already landed. */
  | {
      readonly ok: false;
      readonly held: HeldUpdate;
      readonly memberId?: string;
      readonly members?: readonly CollectionMemberOutcome[];
    };

/**
 * What both install controls need from the region that owns the press: the
 * action itself, which item is in flight, and the last refusal in the host's own
 * words. One shape rather than three props through the gallery, the cell and the
 * modal.
 */
export interface InstallControl {
  readonly onInstall: (item: StoreItem) => void;
  /** A collection's press, which opens the sheet rather than posting here. */
  readonly onInstallCollection?: CollectionInstallPress | undefined;
  /** The items a press is in flight for, so each control disables itself on
   *  its own id and two items install without losing one another's busy state. */
  readonly installingIds: ReadonlySet<string>;
  /** The last refusal and the item it names; a refusal for another item is not
   *  drawn beside this one. */
  readonly refusal:
    | {
        readonly id: string;
        readonly message: string;
        /** A part-way collection failure's per-member outcomes, so the sheet
         *  can name what the host did not write. */
        readonly members?: readonly CollectionMemberOutcome[];
        /** A collection member the host held, with the growth that held it. */
        readonly held?: HeldUpdate;
        /** The held member's id, so the approval press names exactly that
         *  member rather than every chosen one. */
        readonly memberId?: string;
      }
    | undefined;
  /** The update a press was held for, and the item it names. */
  readonly held: { readonly id: string; readonly held: HeldUpdate } | undefined;
  /** Presses the held item again with the approval flag. */
  readonly onApproveUpdate: () => void;
  /** Leaves the notice standing on nothing; nothing was written. For a
   *  collection the hold is carried on the refusal, which this clears too. */
  readonly onDismissUpdate: () => void;
}

/**
 * Posts one catalogue item to the host, which fetches and writes the package.
 * The browser posts the catalogue's facts and reads no bytes: the
 * host owns the download, the validation and the folder, so a client that
 * downloaded here would be a second owner of the same install.
 *
 * Every refusal is the host's own words, for the reason `theme-import.ts`
 * carries out its refusals: the host knows which part of the install failed, and
 * a sentence composed here would hide it. The one exception is a request that
 * never reached the host: the browser's "Failed to fetch" names no step and
 * tells the person nothing they can do, so that failure is logged and answered
 * with the app's own sentence.
 */
export async function installItem(
  item: StoreItem,
  options?: {
    readonly fetch?: typeof fetch;
    /** The approval press for an update the host held. */
    readonly approveUpdate?: boolean;
    /** The one collection member whose held update this press approves. */
    readonly approveMember?: string;
    /** A collection's chosen includes. Absent means every include, which is
     *  what a single item's press has. */
    readonly items?: readonly string[];
  },
): Promise<InstallOutcome> {
  const catalogue = item.catalogue;
  const version = item.version;
  // An online item always carries both; a caller that hands a library item has
  // no package to name, and inventing one would post an install of nothing.
  if (catalogue === undefined || version === undefined || version === "") {
    return {
      ok: false,
      message: uiCopy.store.install.noCatalogueVersion,
    };
  }

  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetcher(INSTALL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageUrl: catalogue.packageUrl,
        catalogueId: catalogue.id,
        version,
        kind: item.kind,
        ...(catalogue.sha256 === undefined ? {} : { sha256: catalogue.sha256 }),
        ...(catalogue.bytes === undefined ? {} : { bytes: catalogue.bytes }),
        ...(catalogue.publisher === undefined
          ? {}
          : { publisher: catalogue.publisher }),
        ...(options?.approveUpdate === true ? { approveUpdate: true } : {}),
        ...(options?.approveMember === undefined
          ? {}
          : { approveMember: options.approveMember }),
        ...(options?.items === undefined ? {} : { items: options.items }),
      }),
    });
  } catch (error) {
    // The raw failure stays off the screen: `TypeError: Failed to fetch` is
    // the browser's, names no step, and is the same sentence for every cause.
    console.error("Yunari: the catalogue install request failed.", error);
    return { ok: false, message: uiCopy.store.install.unreachable };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // The host answers a held update or a part-way collection failure as JSON;
    // both are answers, not opaque refusals. A plain-text refusal falls back to
    // its body as the host wrote it.
    const body = parseObject(text);
    const members = body === undefined ? undefined : membersOf(body["members"]);
    if (body !== undefined && isHeldUpdate(body["held"])) {
      const memberId = body["memberId"];
      return {
        ok: false,
        held: body["held"],
        ...(typeof memberId === "string" && memberId !== ""
          ? { memberId }
          : {}),
        ...(members === undefined ? {} : { members }),
      };
    }
    const message = body?.["message"];
    return {
      ok: false,
      message:
        typeof message === "string" && message.trim() !== ""
          ? message
          : body !== undefined
            ? uiCopy.store.install.refused(response.status)
            : text.trim() === ""
              ? uiCopy.store.install.refused(response.status)
              : text,
      ...(members === undefined ? {} : { members }),
    };
  }

  return { ok: true, ...(await membersFrom(response)) };
}

/** The body as a record, or nothing when it is not JSON or not an object. */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** One row of the install's per-member answer, or nothing when the body is not
 *  that shape. **The outcomes decide what was written**: a collection's `ok`
 *  says the collection applied, and each member's `reason` says whether this
 *  press wrote it or found it already registered. */
async function membersFrom(response: Response): Promise<{
  readonly members?: readonly CollectionMemberOutcome[];
}> {
  // A body is read lazily: installItem already answered ok, and a host that
  // sends none must not turn a successful install into a refusal here.
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body !== "object" || body === null) return {};
  const members = membersOf((body as Record<string, unknown>)["members"]);
  return members === undefined ? {} : { members };
}

function membersOf(
  value: unknown,
): readonly CollectionMemberOutcome[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: CollectionMemberOutcome[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) return undefined;
    const record = row as Record<string, unknown>;
    const id = record["id"];
    const ok = record["ok"];
    const reason = record["reason"];
    if (typeof id !== "string" || id === "" || typeof ok !== "boolean") {
      return undefined;
    }
    if (reason !== undefined && typeof reason !== "string") return undefined;
    rows.push({ id, ok, ...(reason === undefined ? {} : { reason }) });
  }
  return rows;
}
