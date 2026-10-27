import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { hostThemeEnvelopes } from "./host-theme.js";

/**
 * The seeded themes and the one retained old-shape document.
 *
 * The host writes its library from `hostThemeEnvelopes`, so that list — not a
 * generated folder left by a previous run — is what every rendered fixture is.
 * Validating it through the reader every persisted theme goes through is the
 * proof that a seed cannot drift into a document the player would reject.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

describe("the seeded host fixtures", () => {
  for (const envelope of hostThemeEnvelopes()) {
    it(`${envelope.id} validates as a current theme`, () => {
      // A rendered theme needs its three roles: an empty bag is refused once
      // the option is on, so a fixture that loses heading/body/mono fails here.
      const result = readFabricThemeEnvelope(envelope, {
        requireTrioRoles: true,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });
  }
});

it("refuses the retained old-shape fixture, naming typePresets", () => {
  const fixture = JSON.parse(
    readFileSync(
      path.join(here, "fixtures", "e2e-old-shape", "theme.json"),
      "utf8",
    ),
  );
  const result = readFabricThemeEnvelope(fixture);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const named = result.issues
    .map((issue) => `${issue.path} ${issue.message}`)
    .join("\n");
  expect(named).toContain("typePresets");
});
