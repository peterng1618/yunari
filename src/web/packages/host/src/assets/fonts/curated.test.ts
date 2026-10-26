import { describe, expect, it, vi } from "vitest";
import type { SourceContext } from "../source.js";
import { ASSET_SOURCES } from "../sources.js";
import {
  CURATED_FACES,
  CURATED_SOURCE_REVISION,
  CURATED_TRIOS,
} from "./curated.generated.js";
import { curatedFontSource } from "./curated.js";
import { CURATED_SOURCE_ID, faceById, toFontCut } from "./curated-data.js";

const PINNED =
  /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/[a-z0-9-]+@\d+\.\d+\.\d+\/latin-\d+-normal\.woff2$/;

/**
 * Fontsource's licence codes, named. A face is not OFL by default: at the
 * pinned revision 10 of the faces are Ubuntu's UFL-1.0 or Apache-2.0, and
 * they reach 15 pairings, so a generator that assumed OFL would misdeclare
 * them.
 *
 * Looked up with `Object.hasOwn` and never with a truthiness test: this is a
 * bare object, so `LICENSE_URLS["constructor"]` is `Object` and would sail
 * through a guard whose only job is to be loud.
 */
const LICENSE_URLS = {
  "SIL Open Font License 1.1": "https://openfontlicense.org/",
  "Ubuntu Font Licence 1.0": "https://ubuntu.com/legal/font-licence",
  "Apache License 2.0": "https://www.apache.org/licenses/LICENSE-2.0",
} as const;

/**
 * Role and `clamped` are properties of a pairing's *request*, so every
 * assertion about them reads a trio, where position is the role and the flag
 * was computed against this pairing's own recommendation. A standalone face in
 * `CURATED_FACES` carries whichever pairing reached it first and is not safe to
 * ask either question of.
 */
function trioById(id: string) {
  return CURATED_TRIOS.find((trio) => trio.id === id);
}

/**
 * The one upstream title that does not name the families it seeds. Upstream
 * writes `Lead — Heading + Body + Mono` and 15 of the 379 drop the lead, but
 * `cormorant-garamond-proza-libre` is titled "Cormorant Garamond Proza
 * Libre" over Proza Libre + Cormorant Garamond + JetBrains Mono — two of the
 * three run together and the mono is absent.
 *
 * Listed rather than waved through, and asserted as an exact set, so a second
 * offender is red here and a fixed one is red too.
 */
const TITLES_THAT_DO_NOT_NAME_THEIR_FAMILIES = [
  "cormorant-garamond-proza-libre",
];

describe("curated font catalogue", () => {
  it("carries every pairing from the pinned upstream revision", () => {
    // 379, not the 380 registry entries. Upstream's index lists
    // `playfair-display-roboto` twice — once titled for Inter, once for
    // Roboto — and both entries point at one pairing document, which names
    // Roboto. The document is the authority on which entry is true, so the
    // generator keeps the entry whose title matches it and the other never
    // reaches the catalogue. vg-116 is the upstream half of this.
    expect(CURATED_TRIOS).toHaveLength(379);
    expect(CURATED_SOURCE_REVISION).toMatch(/^[0-9a-f]{40}$/);
  });

  it("gives every trio its own id", () => {
    // A duplicate id would collapse in the picker's `Map` and hide the
    // second record rather than show the conflict.
    const ids = CURATED_TRIOS.map((trio) => trio.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("titles every trio with the families it seeds", () => {
    // The duplicate above shipped "Playfair Display Inter" over Roboto faces:
    // a title naming a family the record does not carry, which an author
    // applying it would see as Inter.
    const unnamed = CURATED_TRIOS.filter(
      (trio) =>
        !trio.name.endsWith(trio.faces.map((face) => face.family).join(" + ")),
    ).map((trio) => trio.id);
    expect(unnamed.sort()).toEqual(TITLES_THAT_DO_NOT_NAME_THEIR_FAMILIES);
  });

  it("gives every trio exactly one heading, body and mono face", () => {
    for (const trio of CURATED_TRIOS) {
      expect(trio.faces.map((face) => face.role)).toEqual([
        "heading",
        "body",
        "mono",
      ]);
      for (const face of trio.faces) {
        expect(face.subset).toBe("latin");
        expect(face.format).toBe("woff2");
      }
    }
  });

  it("carries each face's own licence name and URL", () => {
    for (const face of CURATED_FACES) {
      expect(
        Object.hasOwn(LICENSE_URLS, face.license.name),
        `unmapped licence "${face.license.name}"`,
      ).toBe(true);
      expect(face.license.url).toBe(
        LICENSE_URLS[face.license.name as keyof typeof LICENSE_URLS],
      );
    }
    // The set, not just the mapping: a fourth licence upstream must fail here
    // rather than quietly join the catalogue.
    expect(
      [...new Set(CURATED_FACES.map((f) => f.license.name))].sort(),
    ).toEqual(Object.keys(LICENSE_URLS).sort());
  });

  it("pins every face to a version and never to latest", () => {
    for (const face of CURATED_FACES) {
      expect(face.sourceUrl).toMatch(PINNED);
      expect(face.sourceUrl).not.toContain("latest");
    }
  });

  it("deduplicates faces so one family appears once", () => {
    expect(new Set(CURATED_FACES.map((face) => face.id)).size).toBe(
      CURATED_FACES.length,
    );
    // 261, not the design doc's measured 238. That count came from clamping
    // every heading to a uniform 700, which discards the pairing's own `h1`
    // recommendation for 141 of the 379 pairings and then marks the result
    // `clamped` when it is in fact the author's choice. Clamping to the
    // recommendation keeps the extra faces and mislabels fewer.
    expect(CURATED_FACES).toHaveLength(261);
  });

  it("records a heading's clamp per pairing, not per face", () => {
    // Both faces below are shared by three pairings, and for the pairing
    // that reaches each face first the answer is the opposite of what it is
    // here. A flag cached on first touch therefore gets both wrong, in both
    // directions, and neither direction throws.
    //
    // pt-sans-700: pt-sans-nunito recommends 700, which PT Sans ships;
    // pt-sans-lora recommends 600, which it does not. Only the second clamps.
    expect(trioById("pt-sans-lora")?.faces[0]).toMatchObject({
      id: "pt-sans-700",
      weight: 700,
      clamped: true,
    });
    // lato-700: lato-merriweather recommends 600, which Lato does not ship;
    // lato-roboto recommends 700, which it does. Only the first clamps.
    expect(trioById("lato-roboto")?.faces[0]).toMatchObject({
      id: "lato-700",
      weight: 700,
      clamped: false,
    });
  });

  it("never marks a body or mono face as a clamp", () => {
    // gloock-400 is a clamped heading in gloock-instrument-sans, and this was
    // the one body face in the catalogue that inherited that flag. Only a
    // heading ever makes a clamp request, so no body or mono face may carry
    // one however the face was first reached.
    for (const trio of CURATED_TRIOS) {
      expect(trio.faces[1].clamped, trio.id).toBe(false);
      expect(trio.faces[2].clamped, trio.id).toBe(false);
    }
  });

  it("clamps the 49 headings whose family does not ship the recommended weight", () => {
    // 49 of the 379 pairings recommend an `h1` weight their heading family
    // does not publish, and 20 of those families ship no 700 at all. Anton is
    // one of them, so every trio that wants it as a heading is clamped onto
    // the 400 cut.
    expect(CURATED_TRIOS.filter((trio) => trio.faces[0].clamped)).toHaveLength(
      49,
    );
    for (const trio of CURATED_TRIOS) {
      if (trio.faces[0].fontId !== "anton") continue;
      expect(trio.faces[0]).toMatchObject({ weight: 400, clamped: true });
    }
  });
});

describe("curated-data wire mapping", () => {
  it("prefixes every cut id and names this source", () => {
    for (const face of CURATED_FACES) {
      const cut = toFontCut(face);
      expect(cut.id).toBe(`cut:${face.id}`);
      expect(cut.source).toBe(CURATED_SOURCE_ID);
      expect(cut.source).toBe("curated-fonts");
      expect(cut.previewUrl).toBe(face.sourceUrl);
      expect(cut.sourceUrl).toBe(face.sourceUrl);
      expect(cut.licence).toBe(face.license.name);
    }
  });
});

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

function refusingFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("the CDN is down");
  }) as unknown as typeof fetch;
}

describe("curatedFontSource", () => {
  it("declares a font-picker body that needs no credential", () => {
    expect(curatedFontSource).toMatchObject({
      id: "curated-fonts",
      category: "font",
      body: "font-picker",
      requires: undefined,
      configurable: false,
    });
  });

  it("is the source the registry serves", () => {
    expect(ASSET_SOURCES).toContain(curatedFontSource);
  });

  it("finds a trio by a family inside it", async () => {
    const fetcher = refusingFetch();
    const page = await curatedFontSource.search("Inter", 1, context(fetcher));

    const trio = page.results.find(
      (entry) => entry.id === "trio:inter-poppins",
    );
    expect(trio?.font?.trio?.roles.heading?.family).toBe("Inter");
    expect(trio?.font?.cuts).toHaveLength(3);
    // Search reads the catalogue only, so browsing never spends a CDN call.
    expect(fetcher).not.toHaveBeenCalled();
    expect(page.totalPages).toBeUndefined();
  });

  it("finds a family by name and carries its cuts", async () => {
    const page = await curatedFontSource.search(
      "Manrope",
      1,
      context(refusingFetch()),
    );

    const family = page.results.find((entry) => entry.font?.trio === undefined);
    expect(family?.name).toBe("Manrope");
    expect(family?.id).toBe("cut:manrope-400");
    expect(family?.font?.cuts.map((cut) => cut.id)).toEqual([
      "cut:manrope-400",
      "cut:manrope-600",
      "cut:manrope-700",
    ]);
  });

  it("finds a trio by its own title", async () => {
    // The title names all three families in one phrase, which no single
    // family name contains: this is the trio-name clause alone.
    const page = await curatedFontSource.search(
      "Yaldevi Libre Franklin",
      1,
      context(refusingFetch()),
    );

    expect(
      page.results.some((entry) => entry.id === "trio:yaldevi-libre-franklin"),
    ).toBe(true);
  });

  it("finds a trio by its description", async () => {
    // "compact, neutral contrast" appears in one pairing's description and in
    // no name, so only the description clause can answer it.
    const page = await curatedFontSource.search(
      "compact, neutral contrast",
      1,
      context(refusingFetch()),
    );

    expect(
      page.results.some((entry) => entry.id === "trio:yaldevi-libre-franklin"),
    ).toBe(true);
  });

  it("finds a family through a folded query", async () => {
    // Case and separators fold: the catalogue separates "Fira" and "Code"
    // with a space, and the author may type a hyphen in any case.
    const page = await curatedFontSource.search(
      "FIRA-CODE",
      1,
      context(refusingFetch()),
    );

    expect(
      page.results.some(
        (entry) => entry.font?.trio === undefined && entry.name === "Fira Code",
      ),
    ).toBe(true);
    expect(
      page.results.some((entry) => entry.id === "trio:yaldevi-libre-franklin"),
    ).toBe(true);
  });

  it("serves bytes for a cut through the injected fetch", async () => {
    const face = faceById("manrope-400");
    if (face === undefined) throw new Error("no manrope-400 face");
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const bytes = await curatedFontSource.bytesOf(
      toFontCut(face).id,
      context(fetcher),
    );

    expect(calls).toEqual([face.sourceUrl]);
    expect(bytes?.contentType).toBe("font/woff2");
    expect(bytes?.filename).toBe("manrope-400.woff2");
    expect(bytes?.bytes).toEqual(new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
  });

  it("keeps a failed face out of the result instead of failing the search", async () => {
    // The face's bytes are fetched only when it is applied, never while
    // browsing: a dead CDN cannot blank the grid, and the failure reaches the
    // author as a failed bytes read (Task 12) rather than a failed search.
    const page = await curatedFontSource.search(
      "Manrope",
      1,
      context(refusingFetch()),
    );

    expect(page.results.length).toBeGreaterThan(0);
    expect(
      page.results.find((entry) => entry.name === "Manrope")?.font?.cuts,
    ).toHaveLength(3);
  });

  it("answers nothing for an id that names no cut or trio", async () => {
    const fetcher = refusingFetch();

    expect(await curatedFontSource.bytesOf("cut:nope", context(fetcher))).toBe(
      undefined,
    );
    expect(await curatedFontSource.bytesOf("trio:nope", context(fetcher))).toBe(
      undefined,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serves a trio's heading cut by the trio's row id", async () => {
    const trio = trioById("inter-poppins");
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as unknown as typeof fetch;

    const bytes = await curatedFontSource.bytesOf(
      "trio:inter-poppins",
      context(fetcher),
    );

    expect(bytes?.filename).toBe("inter-700.woff2");
    expect(calls).toEqual([trio?.faces[0].sourceUrl]);
  });

  it("reports a face the CDN refuses rather than serving empty bytes", async () => {
    const fetcher = vi.fn(
      async () => new Response("gone", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      curatedFontSource.bytesOf("cut:manrope-400", context(fetcher)),
    ).rejects.toThrow(/404/);
  });
});
