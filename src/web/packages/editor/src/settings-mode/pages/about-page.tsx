import { SUPPORTED_SCHEMA_VERSION } from "@yunari/renderer-core";
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/** One fact the About page renders, identified by the id it renders it under so
 *  a test reads the row by what it is rather than by its position. */
export interface VersionFact {
  readonly id: "product-version" | "schema-version" | "release-version";
  /** The fact's own value. All three are strings; the page renders them as
   *  they are. */
  readonly value: string;
}

/** Each fact's label, by the id it renders under. One owner of "what this row
 *  is called": the release row keeps the Document pane's own word for that fact
 *  (`panels.releaseVersion`), reused rather than respelled. */
const VERSION_FACT_LABELS: Readonly<Record<VersionFact["id"], string>> = {
  "product-version": uiCopy.settings.aboutProductVersion,
  "schema-version": uiCopy.settings.aboutSchemaVersion,
  "release-version": uiCopy.panels.releaseVersion,
};

/** The version facts this build can honestly read, in the order they render.
 *
 *  **Every value is traceable to an owner**: the product version is the
 *  workspace manifest's `version`, substituted by Vite's `define`; the schema
 *  version is `SUPPORTED_SCHEMA_VERSION`; and the release version is the open
 *  document's own `metadata.version`. A document that carries no release
 *  version contributes no row: the missing reading is a gap stated by absence,
 *  never a placeholder that could read as data. */
export function versionFacts(
  releaseVersion: string | undefined,
): readonly VersionFact[] {
  const facts: VersionFact[] = [
    { id: "product-version", value: __YUNARI_VERSION__ },
    { id: "schema-version", value: SUPPORTED_SCHEMA_VERSION },
  ];
  if (releaseVersion !== undefined && releaseVersion !== "") {
    facts.push({ id: "release-version", value: releaseVersion });
  }
  return facts;
}

/**
 * The About page: what this editor is, and the version facts this build can
 * honestly read. It renders `versionFacts` and nothing else, so the one rule it
 * could break — printing a version no owner has — is broken there or not at
 * all.
 */
export function AboutPage(props: {
  readonly releaseVersion: string | undefined;
}): React.JSX.Element {
  return (
    <Page page="about">
      <Group
        testId="about"
        name={uiCopy.settings.pages.about}
        hint={uiCopy.settings.aboutProvenance}
      >
        <div
          className="editor-shell-about flex max-w-[var(--dialog-max-width)] flex-col gap-[var(--space-8)]"
          data-yunari-about=""
        >
          <dl>
            {versionFacts(props.releaseVersion).map((fact) => (
              <div key={fact.id}>
                <dt>{VERSION_FACT_LABELS[fact.id]}</dt>
                <dd
                  className="font-mono text-text"
                  data-yunari-about-fact={fact.id}
                >
                  {String(fact.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Group>
    </Page>
  );
}
