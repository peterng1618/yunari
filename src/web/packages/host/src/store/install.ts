import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  consentRequired,
  deviceAllowlistOf,
  deviceIdentity,
  type ExecutionProfile,
  type InstallResult as PluginInstallResult,
  qualifiedPluginKey,
  readPluginPackage,
} from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  type CollectionInclude,
  type CollectionPlan,
  type CollectionPlanMember,
  catalogueItemUrl,
  isCatalogueId,
  isStoreItemKind,
  parseCatalogueItemFile,
  type StoreItemKind,
} from "@yunari/renderer-core";
import {
  MAX_ARCHIVE_BYTES,
  MAX_COLLECTION_INCLUDES,
  readCollectionPackage,
  readEditorThemePackage,
  readThemePackage,
  readWidgetPackage,
  themeVideoRefusals,
} from "@yunari/theme-package";
import { LOCAL_PLUGIN_PUBLISHER } from "../extensions/install.js";
import type { ExtensionService } from "../extensions/service.js";
import type { WidgetPackStore } from "../packs/widget-packs.js";
import {
  type PathPresetStore,
  readPathPresetPackBytes,
} from "../presets/path-presets.js";
import {
  type CatalogueOriginRow,
  type CatalogueOriginsStore,
  catalogueOriginOf,
  catalogueOriginRows,
} from "../settings/catalogue-origins.js";
import { downloadPackage } from "../themes/download.js";
import {
  installThemeBytes,
  type InstallOptions as ThemeInstallOptions,
} from "../themes/install.js";

/**
 * One store item's Install action, end to end, for every kind the catalogue
 * carries.
 *
 * The trust boundary is one place: `downloadPackage` holds the address and the
 * byte cap, this module checks the store's own SHA-256 and size, and each
 * kind's owner then reads the archive before writing anything. A package that
 * fails any of those stages leaves this machine exactly as it was.
 *
 * The editor posts the store's facts; it never sends bytes. A plugin's consent
 * is required from the execution profile its own manifest declares, never from
 * the request.
 *
 * A collection is the same rule once per chosen member. Every member is
 * fetched, verified, read and consented before the first write; a refused
 * member refuses the collection and writes nothing. The plan route runs that
 * same pre-flight and answers it, and an install never reads a plan back.
 */

export interface CatalogueInstallRequest {
  readonly packageUrl: string;
  readonly catalogueId: string;
  readonly kind: StoreItemKind;
  readonly version: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly publisher: string;
  readonly executionProfile?: ExecutionProfile;
  /** The approval press for an update the update policy held. A single item's
   *  press names it here; a collection's press names the member instead. */
  readonly approveUpdate?: boolean;
  /** The one collection include whose held update this press approves. Every
   *  other chosen member is written without approval, so a growth the person
   *  never saw cannot ride another member's press. */
  readonly approveMember?: string;
  /** A collection's chosen includes. Absent means every include; present must
   *  name every required include and may omit optional ones. */
  readonly items?: readonly string[];
}

export type HeldUpdate = NonNullable<PluginInstallResult["held"]>;

/** One chosen collection member's outcome, after the install applied it. */
export interface CollectionMemberOutcome {
  readonly id: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export type CatalogueInstallResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly consentRequired: boolean;
      /** Present for a collection; absent for a single item. */
      readonly members?: readonly CollectionMemberOutcome[];
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly stage:
        | "address"
        | "download"
        | "integrity"
        | "package"
        | "store"
        /** An update held for review; nothing was written. */
        | "review";
      /** Present only for the `review` stage. */
      readonly held?: HeldUpdate;
      /** The collection include whose write stopped the install. Present for a
       *  collection; the review notice's approval press names this member. */
      readonly memberId?: string;
      /** Present for a collection that started applying members. */
      readonly members?: readonly CollectionMemberOutcome[];
    };

export interface CatalogueInstallStores {
  /** The dashboard theme's owners. Omitted, this host installs no themes. */
  readonly theme?: ThemeInstallOptions;
  readonly widgetPacks?: WidgetPackStore;
  readonly pathPresets?: PathPresetStore;
  readonly extensions?: ExtensionService;
  /** Where an editor theme's `.yunari-theme` file lands, served back through
   *  `/api/editor-themes/:id`. Omitted, this host installs none. */
  readonly editorThemesDirectory?: string;
}

export interface CatalogueInstallOptions {
  readonly stores: CatalogueInstallStores;
  readonly fetch?: typeof fetch;
  /** The configured store origin; absent uses the shipped catalogue. */
  readonly storeOrigin?: string;
  /** Where each write's catalogue origin is recorded. Absent records none,
   *  which also removes collection retry's already-installed skip. */
  readonly origins?: CatalogueOriginsStore;
}

export type CollectionPlanResult =
  | { readonly ok: true; readonly plan: CollectionPlan }
  | {
      readonly ok: false;
      readonly message: string;
      readonly stage: "download" | "integrity" | "package" | "store";
    };

type MemberStage = Extract<
  CatalogueInstallResult,
  { readonly ok: false }
>["stage"];

export async function installCatalogueItem(
  request: CatalogueInstallRequest,
  options: CatalogueInstallOptions,
): Promise<CatalogueInstallResult> {
  if (!isCatalogueId(request.catalogueId)) {
    return refuse("address", "That install names no catalogue item.");
  }

  const fetched = await fetchVerified(request, options);
  if (!fetched.ok) return refuse(fetched.stage, fetched.message);

  return installByKind(request, fetched.bytes, options);
}

/**
 * The collection install sheet's verified answer, without writing.
 *
 * A member that cannot be resolved is a `missing` row rather than a whole
 * refusal: the sheet shows which members are unavailable and the install is
 * refused for the same reason when it is pressed. Only the collection itself
 * failing to read, verify or select is a refusal.
 */
export async function planCollection(
  request: CatalogueInstallRequest,
  options: CatalogueInstallOptions,
): Promise<CollectionPlanResult> {
  if (request.kind !== "collection") {
    return {
      ok: false,
      stage: "package",
      message: "A collection plan needs a collection request.",
    };
  }

  const fetched = await fetchVerified(request, options);
  if (!fetched.ok) {
    return {
      ok: false,
      message: fetched.message,
      // An address the catalogue cannot produce is the request's fault; the
      // plan's stages are the collection's own, so it reads as a package.
      stage: fetched.stage === "address" ? "package" : fetched.stage,
    };
  }

  const parsed = readCollectionPackage(fetched.bytes);
  if (!parsed.ok)
    return { ok: false, stage: "package", message: parsed.message };

  const selection = selectIncludes(parsed.package.includes, request.items);
  if (!selection.ok) {
    return { ok: false, stage: "package", message: selection.message };
  }

  let origins: Readonly<Record<string, CatalogueOrigin>> = {};
  if (options.origins !== undefined) {
    try {
      origins = await options.origins.read();
    } catch (error) {
      return { ok: false, stage: "store", message: messageOf(error) };
    }
  }

  const members: CollectionPlanMember[] = [];
  const missing: { readonly id: string; readonly reason: string }[] = [];
  let totalBytes = 0;

  for (const include of selection.includes) {
    const resolved = await resolveMember(include, options);
    if (!resolved.ok) {
      // The install skips a registered member before it fetches anything, so a
      // listing that has since been unpublished must not block the sheet
      // either. The register names the kind and version; it holds no display
      // name or size, so the id stands in for the name and the row costs no
      // bytes. The install still reports it "Already installed".
      const held = registeredRow(origins, include.id);
      if (held !== undefined) {
        members.push({
          id: include.id,
          kind: held.kind,
          name: include.id,
          version: held.origin.version,
          bytes: 0,
          publisher: "",
          optional: include.optional,
          installedVersion: held.origin.version,
        });
        continue;
      }
      missing.push({ id: include.id, reason: resolved.reason });
      continue;
    }

    const member = resolved.member;
    const installedVersion = installedVersionOf(
      origins,
      member.listing.kind,
      include.id,
    );
    members.push({
      id: include.id,
      kind: member.listing.kind,
      name: member.listing.name,
      version: member.listing.version,
      bytes: member.size,
      publisher: member.listing.publisher ?? "",
      optional: include.optional,
      ...(installedVersion === undefined ? {} : { installedVersion }),
      ...(member.consent === undefined ? {} : { consent: member.consent }),
    });
    totalBytes += member.size;
  }

  return { ok: true, plan: { members, missing, totalBytes } };
}

/**
 * The bytes a request names, after the store's declared size and digest held.
 *
 * One download and one check for the single-item path and the collection path
 * alike, so a collection package is held to exactly what a member is.
 */
async function fetchVerified(
  request: CatalogueInstallRequest,
  options: CatalogueInstallOptions,
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly message: string;
      readonly stage: "address" | "download" | "integrity";
    }
> {
  const downloaded = await downloadPackage(request.packageUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.storeOrigin === undefined
      ? {}
      : { origin: options.storeOrigin }),
  });
  if (!downloaded.ok) {
    return {
      ok: false,
      stage: downloaded.stage,
      message: downloaded.message,
    };
  }

  const digest = await sha256Hex(downloaded.bytes);
  if (
    downloaded.bytes.byteLength !== request.bytes ||
    digest !== request.sha256
  ) {
    return {
      ok: false,
      stage: "integrity",
      message:
        "The downloaded package does not match the size and SHA-256 the store declared.",
    };
  }
  return { ok: true, bytes: downloaded.bytes };
}

async function installByKind(
  request: CatalogueInstallRequest,
  bytes: Uint8Array,
  options: CatalogueInstallOptions,
  collectionId?: string,
): Promise<CatalogueInstallResult> {
  if (request.kind === "collection") {
    return installCollection(request, bytes, options);
  }

  // Read the memberships before the write. The theme installer's one origin
  // write carries them; every other kind's row is written after it.
  const carried = await carriedCollections(request, options);
  const collections = mergeCollections(carried, collectionId);
  const installed = await installOne(request, bytes, options, collections);
  if (!installed.ok) return installed;

  // The dashboard theme wrote its own origin with these memberships. A second
  // write here is the one that could fail after the theme landed and drop them.
  if (request.kind === "dashboard-theme") return installed;

  const recorded = await recordInstalled(
    request,
    installed.id,
    collections,
    options,
  );
  if (!recorded.ok) return refuse("store", recorded.message);
  return installed;
}

async function installCollection(
  request: CatalogueInstallRequest,
  bytes: Uint8Array,
  options: CatalogueInstallOptions,
): Promise<CatalogueInstallResult> {
  const parsed = readCollectionPackage(bytes);
  if (!parsed.ok) return refuse("package", parsed.message);

  const selection = selectIncludes(parsed.package.includes, request.items);
  if (!selection.ok) return refuse("package", selection.message);

  // An approval names one member with a notice the person saw. A set that
  // dropped it would approve a member this press is not installing, and an id
  // the collection never carried would approve nothing at all.
  if (
    request.approveMember !== undefined &&
    !selection.includes.some((include) => include.id === request.approveMember)
  ) {
    return refuse(
      "package",
      `This press does not install the collection member "${request.approveMember}".`,
    );
  }

  // The register is read before any listing. A member with a row is installed,
  // whatever version it records: the collection's own version is unrelated to
  // the member's, and drift is the update path's question. A retry therefore
  // still succeeds when the store no longer serves the listing.
  const registered = await registeredOrigins(options);

  // Pre-flight only the members that still have to be written: every one is
  // fetched, verified, read and consented before the first write, so one
  // refused member leaves every store untouched.
  const resolved = new Map<string, ResolvedMember>();
  for (const include of selection.includes) {
    if (
      registered !== undefined &&
      registeredRow(registered, include.id) !== undefined
    ) {
      continue;
    }
    const member = await resolveMember(include, options);
    if (!member.ok) {
      return refuse(
        member.stage,
        `Collection member "${include.id}": ${member.reason}`,
      );
    }
    resolved.set(include.id, member.member);
  }

  const outcomes: CollectionMemberOutcome[] = [];
  let consentNeeded = false;
  let stoppedAt:
    | {
        readonly id: string;
        readonly message: string;
        readonly stage: MemberStage;
        /** A member whose plugin update the host held for review. The stop
         *  carries it so the browser can offer the review rather than a bare
         *  refusal. */
        readonly held?: HeldUpdate;
      }
    | undefined;

  for (const include of selection.includes) {
    const held =
      registered === undefined
        ? undefined
        : registeredRow(registered, include.id);

    if (stoppedAt !== undefined) {
      outcomes.push(
        held === undefined
          ? {
              id: include.id,
              ok: false,
              reason: "Not attempted after an earlier member failed.",
            }
          : { id: include.id, ok: true, reason: "Already installed." },
      );
      continue;
    }

    if (held !== undefined) {
      try {
        await mergeCollection(options.origins, held, request.catalogueId);
      } catch (error) {
        stoppedAt = {
          id: include.id,
          message: messageOf(error),
          stage: "store",
        };
        outcomes.push({ id: include.id, ok: false, reason: messageOf(error) });
        continue;
      }
      outcomes.push({ id: include.id, ok: true, reason: "Already installed." });
      continue;
    }

    const member = resolved.get(include.id);
    if (member === undefined) {
      // Unreachable: every non-registered include was resolved above.
      stoppedAt = {
        id: include.id,
        message: "The member was not resolved.",
        stage: "package",
      };
      outcomes.push({
        id: include.id,
        ok: false,
        reason: stoppedAt.message,
      });
      continue;
    }

    const installed = await installByKind(
      memberRequest(member, request.approveMember),
      member.bytes,
      options,
      request.catalogueId,
    );
    if (!installed.ok) {
      stoppedAt = {
        id: include.id,
        message: installed.message,
        stage: installed.stage,
        ...("held" in installed && installed.held !== undefined
          ? { held: installed.held }
          : {}),
      };
      outcomes.push({ id: include.id, ok: false, reason: installed.message });
      continue;
    }

    consentNeeded = consentNeeded || installed.consentRequired;
    outcomes.push({ id: include.id, ok: true });
  }

  if (stoppedAt !== undefined) {
    return stopped(
      outcomes,
      stoppedAt.id,
      stoppedAt.message,
      stoppedAt.stage,
      stoppedAt.held,
    );
  }

  return {
    ok: true,
    id: request.catalogueId,
    consentRequired: consentNeeded,
    members: outcomes,
  };
}

/** The one item's path after the bytes are held. `collections` is this
 *  install's merged membership set; only the dashboard theme writes it. */
async function installOne(
  request: CatalogueInstallRequest,
  bytes: Uint8Array,
  options: CatalogueInstallOptions,
  collections: readonly string[],
): Promise<CatalogueInstallResult> {
  const stores = options.stores;
  switch (request.kind) {
    case "dashboard-theme": {
      if (stores.theme === undefined)
        return refuse("store", "This host records no theme origins.");
      const installed = await installThemeBytes(
        request,
        bytes,
        stores.theme,
        collections,
      );
      if (!installed.ok) return refuse(installed.stage, installed.message);
      return { ok: true, id: installed.id, consentRequired: false };
    }

    case "widget-pack": {
      if (stores.widgetPacks === undefined)
        return refuse("store", "This host keeps no widget packs.");
      // The store reads the package before it writes: a refused archive is the
      // package's fault, and the filesystem's failure is its own refusal.
      try {
        const result = await stores.widgetPacks.install(bytes);
        if (!result.ok) return refuse("package", result.message);
        return { ok: true, id: result.pack.id, consentRequired: false };
      } catch (error) {
        return refuse("store", messageOf(error));
      }
    }

    case "path-preset-pack": {
      if (stores.pathPresets === undefined)
        return refuse("store", "This host keeps no path presets.");
      // The saved rows are keyed by the pack's own id, not the catalogue's, and
      // an install replaces every row under that prefix. Two listings whose
      // packages declare one internal id would therefore overwrite each other,
      // so the second is refused before the first's rows are touched.
      const parsed = readPathPresetPackBytes(bytes);
      if (!parsed.ok) return refuse("package", parsed.message);
      if (options.origins !== undefined) {
        let held: CatalogueOrigin | undefined;
        try {
          held = catalogueOriginOf(
            await options.origins.read(),
            "path-preset-pack",
            parsed.pack.id,
          );
        } catch {
          // An unreadable register costs the collision check, not the install.
          held = undefined;
        }
        if (held !== undefined && held.catalogueId !== request.catalogueId) {
          return refuse(
            "package",
            `The path preset pack id "${parsed.pack.id}" is already used by another catalogue item.`,
          );
        }
      }
      try {
        const result = await stores.pathPresets.addPack(bytes);
        return { ok: true, id: result.packId, consentRequired: false };
      } catch (error) {
        return refuse("package", messageOf(error));
      }
    }

    case "editor-theme": {
      if (stores.editorThemesDirectory === undefined)
        return refuse("store", "This host keeps no editor themes.");
      // The reader owns the archive's shape; the write is this host's own file
      // beside the settings the import control reads.
      const parsed = readEditorThemePackage(bytes);
      if (!parsed.ok) return refuse("package", parsed.message);
      try {
        await mkdir(stores.editorThemesDirectory, { recursive: true });
        await writeFile(
          editorThemePath(stores.editorThemesDirectory, request.catalogueId),
          bytes,
        );
      } catch (error) {
        return refuse("store", messageOf(error));
      }
      return { ok: true, id: request.catalogueId, consentRequired: false };
    }

    case "plugin": {
      if (stores.extensions === undefined)
        return refuse("store", "This host keeps no plugins.");
      // The installer reads and writes the same archive; a filesystem refusal
      // is this machine's stage, never an exception that escapes the collection
      // with the earlier members already written.
      let installed: PluginInstallResult;
      try {
        installed = await stores.extensions.install(bytes, {
          approveUpdate: request.approveUpdate === true,
        });
      } catch (error) {
        return refuse("store", messageOf(error));
      }
      if (installed.held !== undefined) {
        return {
          ok: false,
          stage: "review",
          message: "This update asks for access the installed version did not.",
          held: installed.held,
        };
      }
      if (!installed.ok || installed.plugin === undefined) {
        return refuse(
          "package",
          installed.message ?? "That file is not a readable plugin package.",
        );
      }
      // The execution profile comes from the package the host just read, so a
      // request cannot ask for less consent than the plugin needs.
      return {
        ok: true,
        id: installed.plugin.key,
        consentRequired: consentRequired(installed.plugin.manifest.execution),
      };
    }

    case "collection":
      // Handled before this switch: a collection has no archive of its own.
      return refuse(
        "package",
        "A collection cannot install itself as a member.",
      );
  }
}

/** One chosen include after every pre-flight check held. */
interface ResolvedMember {
  readonly id: string;
  readonly optional: boolean;
  readonly listing: {
    readonly kind: StoreItemKind;
    readonly name: string;
    readonly version: string;
    readonly packageUrl: string;
    readonly publisher?: string;
    readonly executionProfile?: string;
  };
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly sha256: string;
  readonly consent?: NonNullable<CollectionPlanMember["consent"]>;
  readonly consentRequired: boolean;
}

type MemberResolution =
  | { readonly ok: true; readonly member: ResolvedMember }
  | {
      readonly ok: false;
      readonly stage: MemberStage;
      readonly reason: string;
    };

/**
 * One include, resolved from its listing and its package: the store's size and
 * digest, then the kind's own reader, then the kill list and consent. Nothing
 * is written here, which is what lets the plan and the pre-flight share it.
 */
async function resolveMember(
  include: CollectionInclude,
  options: CatalogueInstallOptions,
): Promise<MemberResolution> {
  const fetched = await fetchListing(include.id, options);
  if (!fetched.ok) {
    return { ok: false, stage: "download", reason: fetched.reason };
  }
  const listing = fetched.file;

  if (listing.kind === "collection") {
    return {
      ok: false,
      stage: "package",
      reason: "A collection cannot include another collection.",
    };
  }

  const storeGap = missingStoreMessage(listing.kind, options.stores);
  if (storeGap !== undefined) {
    return { ok: false, stage: "store", reason: storeGap };
  }

  if (listing.sha256 === undefined || listing.bytes === undefined) {
    return {
      ok: false,
      stage: "package",
      reason: "The listing records no package size and SHA-256.",
    };
  }

  const downloaded = await downloadPackage(listing.packageUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.storeOrigin === undefined
      ? {}
      : { origin: options.storeOrigin }),
  });
  if (!downloaded.ok) {
    return {
      ok: false,
      stage: downloaded.stage,
      reason: downloaded.message,
    };
  }

  const digest = await sha256Hex(downloaded.bytes);
  if (
    downloaded.bytes.byteLength !== listing.bytes ||
    digest !== listing.sha256
  ) {
    return {
      ok: false,
      stage: "integrity",
      reason:
        "The package does not match the size and SHA-256 its listing declares.",
    };
  }

  let consent: NonNullable<CollectionPlanMember["consent"]> | undefined;
  let needsConsent = false;

  if (listing.kind === "plugin") {
    const read = readPluginPackage(downloaded.bytes);
    if (!read.ok) return { ok: false, stage: "package", reason: read.message };

    const manifest = read.package.manifest;
    // The key the install will record, and the key the host's own kill-list
    // check already uses for an installed plugin.
    const key = qualifiedPluginKey(LOCAL_PLUGIN_PUBLISHER, manifest.id);
    if (await isKilled(options.stores.extensions, key)) {
      return {
        ok: false,
        stage: "package",
        reason: `The store has revoked the plugin "${key}".`,
      };
    }

    consent = {
      key,
      name: manifest.name,
      execution: manifest.execution,
      capabilities: manifest.capabilities,
      devices: deviceAllowlistOf(manifest).map(deviceIdentity),
    };
    needsConsent = consentRequired(manifest.execution);
  } else {
    const read = readMemberPackage(listing.kind, downloaded.bytes);
    if (!read.ok) return { ok: false, stage: "package", reason: read.message };
  }

  return {
    ok: true,
    member: {
      id: include.id,
      optional: include.optional,
      listing,
      bytes: downloaded.bytes,
      size: listing.bytes,
      sha256: listing.sha256,
      ...(consent === undefined ? {} : { consent }),
      consentRequired: needsConsent,
    },
  };
}

/** A member listing, fetched from the configured store origin by its id. The
 *  address is this host's own composition, never the request's. */
async function fetchListing(
  id: string,
  options: CatalogueInstallOptions,
): Promise<
  | {
      readonly ok: true;
      readonly file: {
        readonly kind: StoreItemKind;
        readonly name: string;
        readonly version: string;
        readonly packageUrl: string;
        readonly publisher?: string;
        readonly executionProfile?: string;
        readonly sha256?: string;
        readonly bytes?: number;
      };
    }
  | { readonly ok: false; readonly reason: string }
> {
  let url: URL;
  try {
    url = new URL(catalogueItemUrl(id, options.storeOrigin));
  } catch {
    return { ok: false, reason: "The store origin is not a URL." };
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: `The store answered ${response.status} for "${id}".`,
    };
  }

  const read = await readListingBody(id, response);
  if (!read.ok) return { ok: false, reason: read.reason };

  const parsed = parseCatalogueItemFile(read.value, id);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  // The reader admits a kind this build ships; the wire type keeps room for a
  // newer store's name, so the member path narrows it here.
  const kind = parsed.file.kind;
  if (!isStoreItemKind(kind)) {
    return { ok: false, reason: `Unsupported catalogue kind "${kind}".` };
  }
  return { ok: true, file: { ...parsed.file, kind } };
}

/**
 * A listing's JSON under the package path's byte cap.
 *
 * The cap is enforced while the body arrives rather than after it: a listing is
 * small, and a store that would answer an unbounded body must not be able to
 * make this host buffer it. A declared length over the cap is refused before a
 * byte is read.
 */
async function readListingBody(
  id: string,
  response: Response,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string }
> {
  const tooLarge = `The listing for "${id}" is too large.`;
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > MAX_ARCHIVE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: tooLarge };
    }
  }
  if (response.body === null) {
    return { ok: false, reason: `The listing for "${id}" is not JSON.` };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: tooLarge };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: `The listing for "${id}" is not JSON.` };
  }
}

/** The package readers for every kind that can be a collection member. Each
 *  kind's own reader is the one its install path already uses. */
function readMemberPackage(
  kind: StoreItemKind,
  bytes: Uint8Array,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  switch (kind) {
    case "dashboard-theme": {
      const parsed = readThemePackage(bytes);
      if (!parsed.ok) return parsed;
      const videoRefusal = themeVideoRefusals(
        parsed.envelope,
        parsed.assets,
      )[0];
      return videoRefusal === undefined
        ? { ok: true }
        : { ok: false, message: videoRefusal };
    }
    case "widget-pack":
      return readResult(readWidgetPackage(bytes));
    case "editor-theme":
      return readResult(readEditorThemePackage(bytes));
    case "path-preset-pack": {
      const read = readPathPresetPackBytes(bytes);
      return read.ok ? { ok: true } : { ok: false, message: read.message };
    }
    case "plugin":
      return readResult(readPluginPackage(bytes));
    case "collection":
      return {
        ok: false,
        message: "A collection cannot include another collection.",
      };
  }
}

function readResult(
  result:
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string },
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

/** The host-side sentence for a kind this host cannot keep. */
function missingStoreMessage(
  kind: StoreItemKind,
  stores: CatalogueInstallStores,
): string | undefined {
  switch (kind) {
    case "dashboard-theme":
      return stores.theme === undefined
        ? "This host records no theme origins."
        : undefined;
    case "widget-pack":
      return stores.widgetPacks === undefined
        ? "This host keeps no widget packs."
        : undefined;
    case "path-preset-pack":
      return stores.pathPresets === undefined
        ? "This host keeps no path presets."
        : undefined;
    case "editor-theme":
      return stores.editorThemesDirectory === undefined
        ? "This host keeps no editor themes."
        : undefined;
    case "plugin":
      return stores.extensions === undefined
        ? "This host keeps no plugins."
        : undefined;
    case "collection":
      return undefined;
  }
}

async function isKilled(
  extensions: ExtensionService | undefined,
  key: string,
): Promise<boolean> {
  try {
    return (await extensions?.isKilled?.(key)) === true;
  } catch {
    return false;
  }
}

/** The chosen includes, in the collection's order. A request may omit an
 *  optional include but never a required one, and may not name an id the
 *  collection does not carry. */
function selectIncludes(
  includes: readonly CollectionInclude[],
  items: readonly string[] | undefined,
):
  | { readonly ok: true; readonly includes: readonly CollectionInclude[] }
  | { readonly ok: false; readonly message: string } {
  if (items === undefined) return { ok: true, includes };

  const chosen = new Set(items);
  for (const id of items) {
    if (!includes.some((include) => include.id === id)) {
      return {
        ok: false,
        message: `The collection does not include "${id}".`,
      };
    }
  }
  for (const include of includes) {
    if (!include.optional && !chosen.has(include.id)) {
      return {
        ok: false,
        message: `The collection requires "${include.id}".`,
      };
    }
  }
  return {
    ok: true,
    includes: includes.filter((include) => chosen.has(include.id)),
  };
}

/** The version this machine holds of one catalogue item, for the kind its
 *  listing names. */
function installedVersionOf(
  origins: Readonly<Record<string, CatalogueOrigin>>,
  kind: StoreItemKind,
  catalogueId: string,
): string | undefined {
  return catalogueOriginRows(origins, catalogueId)
    .filter((row) => row.kind === kind)
    .sort((left, right) => left.installedId.localeCompare(right.installedId))[0]
    ?.origin.version;
}

/** The register, or nothing when this host records none or cannot read it. */
async function registeredOrigins(
  options: CatalogueInstallOptions,
): Promise<Readonly<Record<string, CatalogueOrigin>> | undefined> {
  if (options.origins === undefined) return undefined;
  try {
    return await options.origins.read();
  } catch {
    // An unreadable register costs the retry skip, not the install.
    return undefined;
  }
}

/** The row naming this catalogue item, decided from the register alone: a
 *  retry needs no listing to learn the member is already installed. The
 *  recorded version is not compared with the collection's, because the two are
 *  unrelated numbers; a newer member version is the update path's question. */
function registeredRow(
  origins: Readonly<Record<string, CatalogueOrigin>>,
  catalogueId: string,
): CatalogueOriginRow | undefined {
  return catalogueOriginRows(origins, catalogueId)[0];
}

/** Collections are additive: one listing can belong to several, and a later
 *  plain install keeps the memberships the copy already has. */
function mergeCollections(
  existing: readonly string[] | undefined,
  added: string | undefined,
): readonly string[] {
  const union = new Set(existing ?? []);
  if (added !== undefined) union.add(added);
  return [...union].sort();
}

/** The memberships a copy of this catalogue item already records, read before
 *  an install overwrites its row. */
async function carriedCollections(
  request: CatalogueInstallRequest,
  options: CatalogueInstallOptions,
): Promise<readonly string[] | undefined> {
  if (options.origins === undefined) return undefined;
  try {
    const rows = catalogueOriginRows(
      await options.origins.read(),
      request.catalogueId,
    );
    return rows.find((row) => row.kind === request.kind)?.origin.collections;
  } catch {
    // An unreadable register is not a reason to refuse an install; the write
    // below records this membership when it can.
    return undefined;
  }
}

/** Records where the written copy came from, with the memberships its install
 *  carried in. */
async function recordInstalled(
  request: CatalogueInstallRequest,
  installedId: string,
  collections: readonly string[],
  options: CatalogueInstallOptions,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> {
  if (options.origins === undefined) return { ok: true };

  try {
    await options.origins.write(request.kind, installedId, {
      kind: request.kind,
      catalogueId: request.catalogueId,
      version: request.version,
      installedAt: new Date().toISOString(),
      ...(collections.length === 0 ? {} : { collections }),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  return { ok: true };
}

/** A retry's skip still records that the copy is part of this collection. */
async function mergeCollection(
  origins: CatalogueOriginsStore | undefined,
  held: CatalogueOriginRow,
  collectionId: string,
): Promise<void> {
  if (origins === undefined) return;
  await origins.write(held.kind, held.installedId, {
    ...held.origin,
    collections: mergeCollections(held.origin.collections, collectionId),
  });
}

/** The request a member's bytes are installed under. **Only the named member's
 *  update is approved**: a person's approval answers the one notice they saw,
 *  and a second member whose consent also grew stays held until its own notice
 *  is approved. */
function memberRequest(
  member: ResolvedMember,
  approveMember: string | undefined,
): CatalogueInstallRequest {
  return {
    packageUrl: member.listing.packageUrl,
    catalogueId: member.id,
    kind: member.listing.kind,
    version: member.listing.version,
    sha256: member.sha256,
    bytes: member.size,
    publisher: member.listing.publisher ?? "",
    ...(member.listing.executionProfile === undefined
      ? {}
      : {
          executionProfile: member.listing.executionProfile as ExecutionProfile,
        }),
    ...(member.id === approveMember ? { approveUpdate: true } : {}),
  };
}

function stopped(
  members: readonly CollectionMemberOutcome[],
  id: string,
  message: string,
  stage: Extract<CatalogueInstallResult, { readonly ok: false }>["stage"],
  held?: HeldUpdate,
): CatalogueInstallResult {
  return {
    ok: false,
    stage,
    message: `Collection member "${id}": ${message}`,
    memberId: id,
    members,
    ...(held === undefined ? {} : { held }),
  };
}

/** The one file name an installed editor theme is read back by. */
export function editorThemePath(
  directory: string,
  catalogueId: string,
): string {
  return path.join(directory, `${catalogueId}.yunari-theme`);
}

/**
 * The install route's body, or nothing when it is not the request this
 * dispatcher accepts. `publisher` is absent from a listing written before the
 * store derived one, so it reads as an empty slug rather than a refusal.
 */
export function parseCatalogueInstallRequest(
  value: unknown,
): CatalogueInstallRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const body = value as Record<string, unknown>;
  const packageUrl = body["packageUrl"];
  const catalogueId = body["catalogueId"];
  const kind = body["kind"];
  const version = body["version"];
  const sha256 = body["sha256"];
  const bytes = body["bytes"];
  const publisher = body["publisher"];
  const executionProfile = body["executionProfile"];
  const approveUpdate = body["approveUpdate"];
  const approveMember = body["approveMember"];
  const items = readItems(body["items"]);

  if (
    typeof packageUrl !== "string" ||
    packageUrl === "" ||
    typeof catalogueId !== "string" ||
    !isCatalogueId(catalogueId) ||
    !isStoreItemKind(kind) ||
    typeof version !== "string" ||
    version === "" ||
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    typeof bytes !== "number" ||
    !Number.isInteger(bytes) ||
    bytes <= 0 ||
    items === null ||
    (publisher !== undefined && typeof publisher !== "string") ||
    (executionProfile !== undefined && typeof executionProfile !== "string") ||
    (approveUpdate !== undefined && typeof approveUpdate !== "boolean") ||
    (approveMember !== undefined &&
      (typeof approveMember !== "string" || !isCatalogueId(approveMember)))
  ) {
    return undefined;
  }

  return {
    packageUrl,
    catalogueId,
    kind,
    version,
    sha256,
    bytes,
    publisher: publisher ?? "",
    ...(items === undefined ? {} : { items }),
    ...(executionProfile === undefined
      ? {}
      : { executionProfile: executionProfile as ExecutionProfile }),
    ...(approveUpdate === undefined ? {} : { approveUpdate }),
    ...(approveMember === undefined ? {} : { approveMember }),
  };
}

/** A collection's chosen ids, bounded and each a catalogue id. `null` is a
 *  value the request may not carry; `undefined` means every include. */
function readItems(value: unknown): readonly string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_INCLUDES) {
    return null;
  }
  if (
    !value.every(
      (item): item is string => typeof item === "string" && isCatalogueId(item),
    )
  ) {
    return null;
  }
  return value as readonly string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function refuse(
  stage: Extract<CatalogueInstallResult, { ok: false }>["stage"],
  message: string,
): CatalogueInstallResult {
  return { ok: false, stage, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
