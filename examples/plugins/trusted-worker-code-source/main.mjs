/**
 * A code asset source in the trusted-worker profile.
 *
 * The file's exports are named for the host's methods. A dotted name is a
 * string-literal export, which is the only way a JavaScript module can carry
 * one: `export { search as "asset.search" }`.
 *
 * Nothing here reaches the network. The three rows are drawn as SVG so the
 * template has no binary fixtures to keep in sync.
 */

const SOURCE = "example-shapes";
const LICENCE = "CC0 1.0";

const SHAPES = [
  { id: "red", name: "Red square", colour: "#e0525a" },
  { id: "green", name: "Green square", colour: "#3fae7a" },
  { id: "blue", name: "Blue square", colour: "#3f7fd6" },
];

function svgOf(colour) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    `<rect width="64" height="64" fill="${colour}"/>` +
    "</svg>"
  );
}

function shapeOf(shape) {
  return {
    id: shape.id,
    name: shape.name,
    kind: "image",
    // A grid row needs a URL to preview; a data URL needs no host.
    preview: `data:image/svg+xml,${encodeURIComponent(svgOf(shape.colour))}`,
    subtitle: "SVG",
    licence: LICENCE,
    sourceUrl: `https://example.com/${shape.id}`,
  };
}

/** `{query, page, source}` → `{results, totalPages}`. */
export function search(params) {
  const query =
    typeof params?.query === "string" ? params.query.trim().toLowerCase() : "";
  const matches =
    query === ""
      ? SHAPES
      : SHAPES.filter((shape) => shape.name.toLowerCase().includes(query));
  return { results: matches.map(shapeOf), totalPages: 1 };
}

/** `{id, source}` → `{bytes, contentType, filename}`; bytes are base64. */
export function bytes(params) {
  const raw = typeof params?.id === "string" ? params.id : "";
  const id = raw.startsWith(`${SOURCE}:`) ? raw.slice(SOURCE.length + 1) : raw;
  const shape = SHAPES.find((entry) => entry.id === id);
  if (shape === undefined) throw new Error("That is not one of the example shapes.");

  return {
    bytes: Buffer.from(svgOf(shape.colour), "utf8").toString("base64"),
    contentType: "image/svg+xml",
    filename: `${id}.svg`,
  };
}

export { search as "asset.search", bytes as "asset.bytes" };
