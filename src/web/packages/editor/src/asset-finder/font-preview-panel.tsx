import type { AssetResult, FontCut, FontTrioInfo } from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useControlTooltip } from "../components/ui/control-icon-button.js";
import { Glyph, STAR_GLYPH } from "../editor-shell/icons.js";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import { assetBytesUrl } from "./client.js";
import type { FontPreviewState } from "./fonts.js";

/** The trio's roles, in the order the card reads them: a trio that omits a
 *  role still draws heading, body, mono. */
export type FontRole = "heading" | "body" | "mono";

export const ROLES = ["heading", "body", "mono"] as const;

/** A result with the font data the panel draws. `AssetResult.font` is optional
 *  on the wire; the finder selects only results that carry one. */
export type FontResult = AssetResult & {
  readonly font: {
    readonly cuts: readonly FontCut[];
    readonly trio?: FontTrioInfo;
  };
};

/** One token, in the shape the scope row needs it. */
type RolePreset = TypeTokens[string];

function rolePresets(
  presets: TypeTokens,
  role: FontRole,
): readonly RolePreset[] {
  return Object.entries(presets)
    .filter(([id]) => id === role)
    .map(([, token]) => token);
}

export function cutsOf(selected: FontResult): readonly FontCut[] {
  const trio = selected.font.trio;
  if (trio === undefined) return selected.font.cuts;
  return ROLES.flatMap((role) => {
    const cut = trio.roles[role];
    return cut === undefined ? [] : [cut];
  });
}

/**
 * The face a family row is addressed by.
 *
 * A family's cuts are every published file — weight × subset — so position 0 is
 * whatever the provider listed first, which for a Google family is often a
 * subset with no Latin glyphs. Drawn or adopted, that face leaves the author's
 * own text in the browser fallback (a serif), while the row's own id names the
 * cut the host chose as the family's lead: this reads that id rather than an
 * array position.
 *
 * Search namespaces a row as `<source>:<entry id>`, and the entry id is the
 * cut's own id, so the prefix comes off before the comparison.
 */
export function leadCutOf(selected: {
  readonly id: string;
  readonly font?: { readonly cuts: readonly FontCut[] } | undefined;
}): FontCut | undefined {
  const cuts = selected.font?.cuts ?? [];
  const at = selected.id.indexOf(":");
  const entryId = at === -1 ? selected.id : selected.id.slice(at + 1);
  return cuts.find((cut) => cut.id === entryId) ?? cuts[0];
}

/** The faces an import brings with the chosen cut: every published cut of the
 *  family — all weights, subsets and styles — so the preset's weight field has
 *  a face at each weight and a Vietnamese glyph has a file to resolve to. The
 *  chosen cut is included even when the result's own list omits it. */
export function familyCutsOf(
  selected: FontResult,
  chosen: FontCut,
): readonly FontCut[] {
  const cuts = selected.font.cuts.filter((cut) => cut.family === chosen.family);
  return cuts.some((cut) => cut.id === chosen.id) ? cuts : [...cuts, chosen];
}

export function faceStyle(cut: FontCut | undefined): React.CSSProperties {
  return cut === undefined
    ? {}
    : {
        fontFamily: cut.family,
        fontWeight: cut.weight,
        fontStyle: cut.style,
      };
}

/** A trio's favourite toggle: the filled star is the on/off channel, and one
 *  word per state is both the accessible name and the tooltip. */
function TrioFavoriteButton({
  favorite,
  onToggle,
}: {
  readonly favorite: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const label = favorite
    ? uiCopy.assets.fontPreview.unfavorite
    : uiCopy.assets.fontPreview.favorite;
  useControlTooltip(ref, label);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={favorite}
      aria-label={label}
      data-yunari-font-favorite=""
      onClick={onToggle}
      className="ml-auto inline-flex size-[26px] flex-none items-center justify-center rounded-[var(--radius-md)] border border-transparent text-muted enabled:hover:border-edge enabled:hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Glyph icon={STAR_GLYPH} size={13} filled={favorite} />
    </button>
  );
}

/** Holds the specimen faces resident while the panel draws them, and frees
 *  every face it added on unmount or when the selection changes.
 *
 * A cut's source is the host route the same bytes Apply writes are read from
 * ({@link assetBytesUrl}), so a browser that cannot reach the provider's CDN
 * still draws the face the document will carry. A load that fails leaves the
 * card on its fallback family rather than blocking the panel. */
export function useSpecimens(cuts: readonly FontCut[]): void {
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts === undefined || typeof FontFace === "undefined")
      return undefined;
    const added: FontFace[] = [];
    for (const cut of cuts) {
      try {
        const face = new FontFace(
          cut.family,
          `url("${assetBytesUrl(cut.source, cut.id)}")`,
          {
            weight: String(cut.weight),
            style: cut.style,
          },
        );
        fonts.add(face);
        added.push(face);
        void face.load().catch(() => undefined);
      } catch {
        // A URL the browser refuses is the same as one the provider will not
        // serve: the card stays on its fallback face.
      }
    }
    return () => {
      for (const face of added) fonts.delete(face);
    };
  }, [cuts]);
}

/**
 * The finder's 336px preview column: the fixed specimen card, the author's
 * sample text and the family's cut choice (R6, R7, R9).
 *
 * Controlled: the shell owns the sample, the cut and the role, because the
 * footer's actions are built from them. It draws from the result and the role
 * presets it is handed, and reports every change; it never reads a document and
 * never decides a write.
 */
export function FontPreviewPanel({
  selected,
  presets,
  state,
  favorite,
  onChange,
}: {
  readonly selected: FontResult;
  readonly presets: TypeTokens;
  readonly state: FontPreviewState;
  /** The selected trio's favourite state and its one write. Absent for a
   *  family, or when the session offers no favourites store. */
  readonly favorite?: {
    readonly on: boolean;
    readonly toggle: () => void;
  };
  readonly onChange: (next: FontPreviewState) => void;
}): React.JSX.Element {
  const copy = uiCopy.assets.fontPreview;
  const trio = selected.font.trio;
  const sample = state.sample;
  const cutId = state.cutId;
  const role = state.role;

  const cuts = useMemo(() => cutsOf(selected), [selected]);
  useSpecimens(cuts);
  /** Cuts that share a weight and style: their labels would read the same, so
   *  the subset is what names the difference between them. */
  const shared = useMemo(() => {
    const seen = new Map<string, number>();
    for (const cut of selected.font.cuts) {
      const key = `${cut.weight}|${cut.style}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set(
      selected.font.cuts
        .filter((cut) => (seen.get(`${cut.weight}|${cut.style}`) ?? 0) > 1)
        .map((cut) => cut.id),
    );
  }, [selected]);

  const selectedCut =
    selected.font.cuts.find((cut) => cut.id === cutId) ?? leadCutOf(selected);

  return (
    <section
      data-yunari-font-preview={trio === undefined ? "family" : "trio"}
      aria-label={trio === undefined ? copy.familyTitle : copy.trioTitle}
      className="flex w-[var(--font-preview-width)] flex-none flex-col gap-[var(--space-10)] rounded-[var(--radius-md)] border border-edge bg-[var(--panel)] p-[var(--space-12)]"
    >
      <div className="flex items-center gap-[var(--space-8)] border-b border-edge pb-[var(--space-6)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          {trio === undefined ? copy.familyTitle : copy.trioTitle}
        </span>
        {trio === undefined || favorite === undefined ? null : (
          <TrioFavoriteButton
            favorite={favorite.on}
            onToggle={favorite.toggle}
          />
        )}
      </div>

      <div className="flex flex-col gap-[var(--space-4)]">
        <span className="text-sm font-semibold">
          {trio === undefined ? selected.name : trio.name}
        </span>
        <span className="text-xs text-muted">
          {trio === undefined ? selected.subtitle : trio.description}
        </span>
        {trio === undefined ? (
          <span className="font-mono text-[10px] text-faint">
            {uiCopy.assets.fontFamilyMeta(selected.font.cuts.length)} ·{" "}
            {selected.licence}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-[var(--space-6)]">
        <label htmlFor="font-preview-sample" className="text-xs text-muted">
          {copy.sampleLabel}
        </label>
        <input
          id="font-preview-sample"
          data-yunari-font-preview-sample=""
          value={sample}
          onChange={(event) => {
            onChange({ ...state, sample: event.target.value });
          }}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-6)] py-[var(--space-4)] text-xs"
        />
        <button
          type="button"
          data-yunari-font-preview-reset=""
          onClick={() => {
            onChange({ ...state, sample: copy.sampleDefault });
          }}
          className="text-[10px] text-faint"
        >
          {copy.sampleReset}
        </button>
      </div>

      {trio === undefined ? (
        <>
          <div
            data-yunari-font-specimen="family"
            className="flex h-[158px] flex-col justify-center gap-[var(--space-6)] rounded-[var(--radius-md)] bg-[image:var(--font-specimen-backdrop)] p-[var(--space-12)]"
          >
            <span
              style={faceStyle(selectedCut)}
              className="text-[length:var(--font-specimen-glyph-size)] leading-[1.08]"
            >
              {sample}
            </span>
            <span className="text-xs text-muted">{copy.glyphs}</span>
            {selectedCut === undefined ? null : (
              <span className="font-mono text-2xs text-faint">
                {selectedCut.family} · {selectedCut.weight}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-[var(--space-6)]">
            <div className="flex items-center gap-[var(--space-6)]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                {copy.cuts}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {selected.font.cuts.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-[var(--space-4)]">
              {selected.font.cuts.map((cut) => {
                const chosen = cut.id === selectedCut?.id;
                return (
                  <button
                    key={cut.id}
                    type="button"
                    aria-pressed={chosen}
                    data-yunari-font-cut={cut.id}
                    onClick={() => {
                      onChange({ ...state, cutId: cut.id });
                    }}
                    className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-6)] py-[var(--space-4)] text-[10px] text-muted aria-pressed:border-accent aria-pressed:text-accent"
                  >
                    {copy.cutLabel(
                      cut.weight,
                      cut.style === "italic",
                      shared.has(cut.id) ? cut.subset : undefined,
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] p-[var(--space-8)]">
            <span className="flex min-w-0 flex-col gap-[var(--space-4)]">
              <span className="text-[11px]">{copy.newPreset}</span>
              <span className="text-[10px] text-muted">
                {copy.newPresetSummary(
                  copy.role[role],
                  selectedCut?.family ?? selected.name,
                  presets[role] !== undefined,
                )}
              </span>
            </span>
            <label className="ml-auto flex items-center gap-[var(--space-4)] text-[10px] text-muted">
              {copy.roleLabel}
              <select
                data-yunari-font-role=""
                value={role}
                onChange={(event) => {
                  onChange({
                    ...state,
                    role: event.target.value as FontRole,
                  });
                }}
                className="rounded-[var(--radius-sm)] border border-edge bg-[var(--bg)] px-[var(--space-4)] py-[var(--space-4)] text-[10px]"
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {copy.role[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* A chosen role is the token's id, so adding to a role the theme
              already has replaces that token's face. The write is the footer's;
              the note names what that write will do. */}
          {presets[role] === undefined ? null : (
            <p
              data-yunari-font-role-replaces=""
              className="m-0 text-[10px] text-faint"
            >
              {copy.replacesRole(copy.role[role])}
            </p>
          )}

          <p className="text-[10px] leading-[1.45] text-faint">
            {copy.familyNote}
          </p>
        </>
      ) : (
        <>
          <div
            data-yunari-font-specimen="trio"
            className="flex h-[var(--font-trio-specimen-height)] flex-col gap-[var(--space-6)] rounded-[var(--radius-md)] bg-[image:var(--font-specimen-backdrop)] p-[var(--space-12)]"
          >
            {ROLES.map((roleName) => {
              const cut = trio.roles[roleName];
              return (
                <span
                  key={roleName}
                  data-yunari-font-specimen-role={roleName}
                  style={faceStyle(cut)}
                  className={
                    roleName === "heading"
                      ? "text-lg leading-[1.12]"
                      : roleName === "body"
                        ? "text-xs leading-[1.5] text-muted"
                        : "mt-auto font-mono text-[10px]"
                  }
                >
                  {sample}
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-[var(--space-6)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              {copy.appliesTo}
            </span>
            <span className="flex-1 border-t border-edge" />
            <span className="text-2xs text-faint">{copy.addsMissingRoles}</span>
          </div>

          <div data-yunari-font-scope="" className="font-mono text-[10px]">
            {ROLES.map((roleName) =>
              copy.scopeCount(
                copy.role[roleName],
                rolePresets(presets, roleName).length,
              ),
            ).join(" · ")}
          </div>

          <div className="flex flex-col gap-[var(--space-4)]">
            {ROLES.map((roleName) => {
              const entries = rolePresets(presets, roleName);
              const after = trio.roles[roleName];
              const first = entries[0];
              return (
                <div
                  key={roleName}
                  data-yunari-font-scope-row={roleName}
                  className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-6)] py-[var(--space-4)]"
                >
                  <span className="flex items-center gap-[var(--space-6)]">
                    <span className="text-[10px]">{copy.role[roleName]}</span>
                    <span className="ml-auto font-mono text-2xs text-faint">
                      {entries.length === 0
                        ? copy.willBeCreated
                        : copy.roleCount(entries.length)}
                    </span>
                  </span>
                  {first === undefined || after === undefined ? null : (
                    <span
                      data-yunari-font-change={roleName}
                      className="font-mono text-[10px] text-muted"
                    >
                      {copy.change(
                        first.family,
                        first.weight,
                        after.family,
                        after.weight,
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {ROLES.every(
            (roleName) => rolePresets(presets, roleName).length === 0,
          ) ? (
            <p
              data-yunari-font-apply-reason=""
              className="text-[10px] leading-[1.45] text-faint"
            >
              {copy.rolelessReason}
            </p>
          ) : null}

          <p className="text-[10px] leading-[1.45] text-faint">
            {copy.trioNote}
          </p>
        </>
      )}
    </section>
  );
}
