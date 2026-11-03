import path from "node:path";
import { describe, expect, it } from "vitest";
import { weatherIconDirectories } from "./media-routes.js";

/**
 * The bundled host flattens `server/` into `dist/main.js`, so the module's own
 * directory moves one level closer to the package root. The vendored icons have
 * to be found in both layouts; resolving only the source one made every
 * `/api/weather/icon/<slug>.svg` a 404 in the built host.
 */
describe("weather icon directories", () => {
  const packageRoot = path.resolve("/repo/src/web/packages/host");
  const vendored = path.join(packageRoot, "vendor", "weather-icons");

  it("finds the vendor folder beside a bundled dist/main.js", () => {
    expect(weatherIconDirectories(path.join(packageRoot, "dist"))).toContain(
      vendored,
    );
  });

  it("finds the vendor folder beside the source module", () => {
    expect(
      weatherIconDirectories(path.join(packageRoot, "src", "server")),
    ).toContain(vendored);
  });
});
