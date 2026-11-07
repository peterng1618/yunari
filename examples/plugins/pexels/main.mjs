/**
 * Pexels image source.
 *
 * Search runs through the host's `network.fetch` so the term reaches only the
 * declared host. The API key is the plugin's own secret, read through
 * `secrets.get`; it never enters a result or a log. Photo bytes arrive through
 * `network.fetchBytes`, which reaches the same declared hosts under the same
 * destination policy and the host's own size cap.
 */

const API = "https://api.pexels.com/v1";
const PER_PAGE = 24;
const KEY = "apiKey";
const NO_KEY =
  "Pexels needs an API key. Add one in Settings → Extensions → Pexels.";
const BAD_KEY =
  "Pexels refused that API key. Check it in Settings → Extensions → Pexels.";
const MAX_BYTES = 32 * 1024 * 1024;

let host;

export function setHostApi(api) {
  host = api;
}

function text(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function apiKey() {
  if (host === undefined) throw new Error("The host API is not ready.");
  const value = await host.call("secrets.get", { key: KEY });
  if (typeof value !== "string" || value === "") throw new Error(NO_KEY);
  return value;
}

async function getJson(path, key) {
  const answer = await host.call("network.fetch", {
    url: `${API}${path}`,
    headers: { Authorization: key },
  });
  if (answer === null || typeof answer !== "object" || answer.ok !== true) {
    if (answer?.status === 401 || answer?.status === 403) {
      throw new Error(BAD_KEY);
    }
    throw new Error(answer?.reason ?? "Pexels did not answer.");
  }
  return answer.body;
}

/** The grid row, or undefined when the entry cannot name one. */
function photoResult(photo) {
  const id = photo?.id;
  const page = text(photo?.url);
  const src = photo?.src;
  const preview = text(src?.medium) ?? text(src?.small) ?? text(src?.tiny);
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    page === undefined ||
    preview === undefined
  ) {
    return undefined;
  }

  return {
    id: String(id),
    name: text(photo.alt) ?? "Pexels photo",
    kind: "image",
    preview,
    subtitle: text(photo.photographer),
    licence: "Pexels License",
    sourceUrl: page,
  };
}

async function search(params) {
  const query =
    typeof params?.query === "string" ? params.query.trim() : "";
  const page =
    Number.isInteger(params?.page) && params.page >= 1 ? params.page : 1;
  const key = await apiKey();

  const path =
    query === ""
      ? `/curated?page=${page}&per_page=${PER_PAGE}`
      : `/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${PER_PAGE}`;

  const body = await getJson(path, key);
  const photos = Array.isArray(body?.photos) ? body.photos : [];
  const results = photos.map(photoResult).filter(Boolean);

  const total = Number(body?.total_results);
  return {
    results,
    totalPages:
      Number.isFinite(total) && total > 0
        ? Math.max(page, Math.ceil(total / PER_PAGE))
        : undefined,
  };
}

async function bytes(params) {
  const raw = typeof params?.id === "string" ? params.id : "";
  const id = raw.replace(/^pexels:/, "");
  if (!/^[0-9]+$/.test(id)) throw new Error("That is not a Pexels photo id.");

  const key = await apiKey();
  const photo = await getJson(`/photos/${id}`, key);
  const src = photo?.src ?? {};
  const url = text(src.large2x) ?? text(src.original) ?? text(src.large);
  if (url === undefined) {
    throw new Error("Pexels did not name image bytes for that photo.");
  }

  const response = await host.call("network.fetchBytes", { url });
  if (response === null || typeof response !== "object" || response.ok !== true) {
    throw new Error(response?.reason ?? "Pexels did not answer that image.");
  }

  const image = Buffer.from(response.bytes);
  if (image.byteLength > MAX_BYTES) {
    throw new Error("That image is larger than the host accepts.");
  }

  const type = String(response.contentType ?? "").trim();
  return {
    bytes: image.toString("base64"),
    contentType: /^image\/[\w.+-]+$/i.test(type) ? type : "image/jpeg",
    filename: `pexels-${id}.jpg`,
  };
}

export { search as "asset.search", bytes as "asset.bytes" };
