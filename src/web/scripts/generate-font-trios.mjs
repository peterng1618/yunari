#!/usr/bin/env node
// Generates packages/host/src/assets/fonts/curated.generated.ts from the
// Fonttrio registry at a pinned commit. Manual: `npm run fonts:generate`. No
// build and no test may invoke it - the output is committed, and the shape test
// is what catches a bad refresh.
//
// Fonttrio pairing metadata is MIT licensed and copied as data, not as a
// dependency. The faces are pinned Fontsource WOFF2 artifacts, each under its
// own licence.
//
// Decision: docs/decisions/0024-the-catalogue-is-generated-from-a-pinned-upstream-revision.md
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The revision the committed catalogue was measured against. */
const PINNED_COMMIT = "8af7098ada0b90f076fbfe260244d11b05dd2403";
const COMMIT = process.env["FONTTRIO_COMMIT"] ?? PINNED_COMMIT;
if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  throw new Error(`FONTTRIO_COMMIT must be a full sha, got "${COMMIT}".`);
}

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OUT = path.join(
  ROOT,
  "packages/host/src/assets/fonts/curated.generated.ts",
);
const FONTTRIO_RAW = `https://raw.githubusercontent.com/kapishdima/fonttrio/${COMMIT}`;
const FONTSOURCE_API = "https://api.fontsource.org/v1/fonts";
const UA = { "User-Agent": "yunari-font-catalogue" };
const ROLES = ["heading", "body", "mono"];

/**
 * Fontsource answers with a short licence code, and each one names its own
 * licence. A code this table does not know is a throw rather than a fallback:
 * every face here is a shipped artefact, and a fallback would put a licence in
 * `THIRD-PARTY-NOTICES.md` that the artefact is not under.
 */
const LICENSES = {
  "OFL-1.1": {
    name: "SIL Open Font License 1.1",
    url: "https://openfontlicense.org/",
  },
  "UFL-1.0": {
    name: "Ubuntu Font Licence 1.0",
    url: "https://ubuntu.com/legal/font-licence",
  },
  "Apache-2.0": {
    name: "Apache License 2.0",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
  },
};

async function json(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

/**
 * Bounded concurrency, index-ordered. Fetches are allowed to finish in any
 * order and the output still is not: every result lands at its own index, so
 * the emitted bytes are a function of the commit and not of the network.
 */
async function jsonAll(urls, limit = 16) {
  const out = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, urls.length) }, async () => {
      while (next < urls.length) {
        const index = next++;
        out[index] = await json(urls[index]);
      }
    }),
  );
  return out;
}

/**
 * Upstream names the family in the `var()` its cssVars point at, and that
 * string is the Fontsource id. A family Fontsource does not know throws: the
 * fallback the plan sketched was measured across all 1140 role faces and never
 * taken once, so nothing downstream needs it to degrade.
 */
function familyIdOf(pairing, role) {
  const value = pairing.cssVars?.theme?.[`--font-${role}`];
  const match = typeof value === "string" ? /^var\(--font-(.+)\)$/.exec(value) : null;
  if (!match) throw new Error(`${pairing.name}: --font-${role} is ${value}`);
  return match[1];
}

/**
 * The weight the pairing's author recommended for `h1`, not a uniform 700 —
 * 141 of the 379 pairings recommend something else, and the picker renders
 * whatever this resolves to, so a uniform clamp would present the clamp as
 * the author's choice.
 */
function headingWeight(pairing) {
  const weight = Number(pairing.css?.["@layer base"]?.h1?.["font-weight"]);
  if (!Number.isInteger(weight)) {
    throw new Error(`${pairing.name}: no h1 font-weight recommendation.`);
  }
  return weight;
}

/** A family ships the cuts it ships; a request it cannot serve takes the nearest. */
function nearest(weights, target) {
  if (weights.includes(target)) return target;
  return weights.reduce((best, weight) =>
    Math.abs(weight - target) < Math.abs(best - target) ? weight : best,
  );
}

const registry = await json(`${FONTTRIO_RAW}/registry.json`);
const pairings = await jsonAll(
  registry.pairings.map(
    (entry) => `${FONTTRIO_RAW}/registry/pairings/${entry.name}.json`,
  ),
);

/**
 * One trio per pairing, not per registry entry.
 *
 * Upstream's index is not one-to-one with its documents: at the pinned commit
 * it lists 380 entries for 379 pairings, and `playfair-display-roboto` appears
 * twice — once titled "Playfair Display Inter" and once "Playfair Display
 * Roboto" — with both entries pointing at one pairing document, which names
 * Roboto. Taking both would emit two records under one id, the first titled
 * for a family it does not seed.
 *
 * The pairing document is the authority on which entry is true, because it is
 * what the faces are read from, so the entry whose title matches it wins.
 * Exactly one match is required: none means the index has drifted away from
 * the documents, and two means the entries cannot be told apart at all.
 * Either is a throw, on the same grounds as an unknown family — an upstream
 * index that contradicts itself is something to see, not to guess at.
 *
 * Grouped and matched on the index into the ordered fetches above, so the
 * result never depends on which entry arrived first.
 */
function resolvePairings(entries, documents) {
  const byName = new Map();
  for (const [index, entry] of entries.entries()) {
    const group = byName.get(entry.name) ?? [];
    group.push({ entry, index });
    byName.set(entry.name, group);
  }

  const resolved = [];
  for (const [name, group] of byName) {
    const matching = group.filter(
      ({ entry, index }) => entry.title === documents[index].title,
    );
    if (matching.length !== 1) {
      throw new Error(
        `${name}: ${matching.length} of ${group.length} registry entries match ` +
          `the pairing document's own title; exactly one must.`,
      );
    }
    resolved.push({ name, ...matching[0] });
  }
  return resolved;
}

const resolvedPairings = resolvePairings(registry.pairings, pairings);

/** `--font-*` per pairing per role, extracted once: the family sweep below
 * and the trio loop both need it, and the pairing document is the only place
 * the answer lives. */
const roleFamilies = pairings.map((p) =>
  ROLES.map((role) => familyIdOf(p, role)),
);
const familyIds = [...new Set(roleFamilies.flat())];
const metadata = await jsonAll(
  familyIds.map((id) => `${FONTSOURCE_API}/${id}`),
);
const families = new Map(familyIds.map((id, index) => [id, metadata[index]]));

const faceCache = new Map();

function faceFor(pairing, role, familyId) {
  const meta = families.get(familyId);
  if (!meta) throw new Error(`${pairing.name}: Fontsource does not know ${familyId}.`);
  if (!meta.subsets.includes("latin")) {
    throw new Error(`${pairing.name}: ${meta.family} has no latin subset.`);
  }
  // Object.hasOwn, never a truthiness test: `LICENSES["constructor"]` is
  // `Object`, so a plain guard would pass and JSON.stringify would then drop
  // the function, emitting faces with no licence at all — the one outcome
  // this table exists to make impossible.
  if (!Object.hasOwn(LICENSES, meta.license)) {
    throw new Error(`${meta.id}: unmapped licence "${meta.license}".`);
  }
  const license = LICENSES[meta.license];

  const weights = Array.isArray(meta.weights) ? meta.weights : [meta.weights];
  // Every body and mono family publishes 400, so only headings ever clamp.
  // A body or mono face that cannot serve 400 is an upstream change worth
  // seeing, not something to record as `clamped: false`.
  const recommended = role === "heading" ? headingWeight(pairing) : 400;
  const weight = nearest(weights, recommended);
  if (role !== "heading" && weight !== 400) {
    throw new Error(
      `${meta.id} has no 400 for ${role}; weights ${JSON.stringify(weights)}.`,
    );
  }

  const id = `${meta.id}-${weight}`;
  if (!faceCache.has(id)) {
    faceCache.set(id, {
      id,
      fontId: meta.id,
      family: meta.family,
      role,
      weight,
      style: "normal",
      format: "woff2",
      subset: "latin",
      sourceUrl: `https://cdn.jsdelivr.net/fontsource/fonts/${meta.id}@${meta.npmVersion}/latin-${weight}-normal.woff2`,
      license,
      clamped: role === "heading" && weight !== recommended,
    });
  }
  // Both `role` and `clamped` describe *this* pairing's request rather than
  // the face: one face can serve more than one role, and the same
  // `(family, weight)` is a clamp for a pairing that recommends a weight the
  // family does not ship and not a clamp for one that recommends the weight
  // it does. The cached record keeps whichever pairing reached the face
  // first, so both are re-stamped here. A cached value puts the wrong flag on
  // nine of the 379 trios, in both directions — that count is what a
  // first-touch cache would produce today, not a historical tally.
  return {
    ...faceCache.get(id),
    role,
    clamped: role === "heading" && weight !== recommended,
  };
}

const trios = [];
for (const { entry, index } of resolvedPairings) {
  const pairing = pairings[index];
  const faces = ROLES.map((role, at) =>
    faceFor(pairing, role, roleFamilies[index][at]),
  );
  trios.push({
    id: entry.name,
    name: entry.title,
    description: pairing.description,
    categories: pairing.categories ?? [],
    mood: pairing.meta?.mood ?? [],
    useCase: pairing.meta?.useCase ?? [],
    superfamily: families.get(faces[0].fontId).category,
    faces,
  });
}

// Code-point order, not localeCompare: the emitted file has to be byte-stable
// for a given commit regardless of the host's ICU collation.
const faces = [...faceCache.values()].sort((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);

const module = `// Generated by \`npm run fonts:generate\`. Do not edit by hand.
//
// Pairing metadata is copied as data from Fonttrio (MIT,
// https://github.com/kapishdima/fonttrio) at commit ${COMMIT}. The faces are
// pinned Fontsource WOFF2 artifacts; each carries its own licence - OFL-1.1 for
// most, UFL-1.0 and Apache-2.0 for the Ubuntu families, Roboto Slab and
// Yellowtail. A heading weight is clamped to the nearest the family ships, and
// \`clamped\` records when that happened.
//
// Read \`role\` and \`clamped\` off a trio's faces, never off a standalone face in
// \`CURATED_FACES\`. Both describe a pairing's request rather than the face:
// a standalone entry carries whichever pairing reached that face first, and
// the same \`(family, weight)\` is a clamp for one pairing and not for another.
//
// Deliberately past the 800-line stop in AGENTS.md, and the exception is
// recorded rather than assumed: 807 KB raw is 28.5 KB brotli, the file is
// read once and never hand-edited, and \`npm run size\` gates the player
// rather than the host. See docs/decisions/0024.

export type CuratedTrioRole = "heading" | "body" | "mono";

export interface CuratedFace {
  readonly id: string;
  readonly fontId: string;
  readonly family: string;
  readonly role: CuratedTrioRole;
  readonly weight: number;
  readonly style: "normal";
  readonly format: "woff2";
  readonly subset: "latin";
  readonly sourceUrl: string;
  readonly license: { readonly name: string; readonly url: string };
  readonly clamped: boolean;
}

export interface CuratedTrio {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly mood: readonly string[];
  readonly useCase: readonly string[];
  readonly superfamily: string;
  readonly faces: readonly [CuratedFace, CuratedFace, CuratedFace];
}

export const CURATED_SOURCE_REVISION = ${JSON.stringify(COMMIT)};

export const CURATED_TRIOS: readonly CuratedTrio[] = ${JSON.stringify(trios, null, 2)};

export const CURATED_FACES: readonly CuratedFace[] = ${JSON.stringify(faces, null, 2)};
`;

await writeFile(OUT, module, "utf8");
// biome.json covers src/web/**/*.ts, so the formatter has to see the emitted
// module or `npm run format:check` goes red on the next run. It is invoked as a
// child process rather than imported: biome is a dev dependency, not a runtime
// one, and this script is manual.
execFileSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules/@biomejs/biome/bin/biome"),
    "format",
    "--write",
    OUT,
  ],
  { stdio: "inherit" },
);

console.log(
  `Wrote ${trios.length} trios and ${faces.length} faces from ${COMMIT}.`,
);
