import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  consentRequired,
  type ExecutionProfile,
  type InstallResult as PluginInstallResult,
} from "@yunari/extension-api";
import {
  isCatalogueId,
  isStoreItemKind,
  type StoreItemKind,
} from "@yunari/renderer-core";
import { readEditorThemePackage } from "@yunari/theme-package";
import type { ExtensionService } from "../extensions/service.js";
import type { WidgetPackStore } from "../packs/widget-packs.js";
import type { PathPresetStore } from "../presets/path-presets.js";
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
  /** The approval press for an update the update policy held. */
  readonly approveUpdate?: boolean;
}

export type HeldUpdate = NonNullable<PluginInstallResult["held"]>;

export type CatalogueInstallResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly consentRequired: boolean;
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
}

export async function installCatalogueItem(
  request: CatalogueInstallRequest,
  options: CatalogueInstallOptions,
): Promise<CatalogueInstallResult> {
  if (!isCatalogueId(request.catalogueId)) {
    return refuse("address", "That install names no catalogue item.");
  }

  const downloaded = await downloadPackage(request.packageUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.storeOrigin === undefined
      ? {}
      : { origin: options.storeOrigin }),
  });
  if (!downloaded.ok) {
    return refuse(downloaded.stage, downloaded.message);
  }

  const digest = await sha256Hex(downloaded.bytes);
  if (
    downloaded.bytes.byteLength !== request.bytes ||
    digest !== request.sha256
  ) {
    return refuse(
      "integrity",
      "The downloaded package does not match the size and SHA-256 the store declared.",
    );
  }

  return installByKind(request, downloaded.bytes, options.stores);
}

async function installByKind(
  request: CatalogueInstallRequest,
  bytes: Uint8Array,
  stores: CatalogueInstallStores,
): Promise<CatalogueInstallResult> {
  switch (request.kind) {
    case "dashboard-theme": {
      if (stores.theme === undefined)
        return refuse("store", "This host records no theme origins.");
      const installed = await installThemeBytes(request, bytes, stores.theme);
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
      const installed: PluginInstallResult = await stores.extensions.install(
        bytes,
        { approveUpdate: request.approveUpdate === true },
      );
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
  }
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
    (publisher !== undefined && typeof publisher !== "string") ||
    (executionProfile !== undefined && typeof executionProfile !== "string") ||
    (approveUpdate !== undefined && typeof approveUpdate !== "boolean")
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
    ...(executionProfile === undefined
      ? {}
      : { executionProfile: executionProfile as ExecutionProfile }),
    ...(approveUpdate === undefined ? {} : { approveUpdate }),
  };
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
