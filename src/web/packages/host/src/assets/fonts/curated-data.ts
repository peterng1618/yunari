import type { FontCut, FontTrioInfo } from "@yunari/renderer-core";
import {
  CURATED_FACES,
  CURATED_SOURCE_REVISION,
  CURATED_TRIOS,
  type CuratedFace,
  type CuratedTrio,
  type CuratedTrioRole,
} from "./curated.generated.js";

/** The `AssetSource` id these faces are served under. */
export const CURATED_SOURCE_ID = "curated-fonts";

export type { CuratedFace, CuratedTrio, CuratedTrioRole };
export { CURATED_FACES, CURATED_SOURCE_REVISION, CURATED_TRIOS };

const TRIO_BY_ID = new Map(CURATED_TRIOS.map((trio) => [trio.id, trio]));
const FACE_BY_ID = new Map(CURATED_FACES.map((face) => [face.id, face]));

export function trioById(id: string): CuratedTrio | undefined {
  return TRIO_BY_ID.get(id);
}

export function faceById(id: string): CuratedFace | undefined {
  return FACE_BY_ID.get(id);
}

/** A face as the wire speaks it. `id` is this source's own byte id, the one
 *  `/api/assets/bytes` strips the `<source>:` prefix from and hands back. */
export function toFontCut(face: CuratedFace): FontCut {
  return {
    id: `cut:${face.id}`,
    source: CURATED_SOURCE_ID,
    family: face.family,
    weight: face.weight,
    style: face.style,
    subset: face.subset,
    format: face.format,
    previewUrl: face.sourceUrl,
    licence: face.license.name,
    sourceUrl: face.sourceUrl,
  };
}

export function toFontTrioInfo(trio: CuratedTrio): FontTrioInfo {
  const roles: Partial<Record<CuratedTrioRole, FontCut>> = {};
  for (const face of trio.faces) roles[face.role] = toFontCut(face);
  return {
    id: trio.id,
    name: trio.name,
    description: trio.description,
    roles,
  };
}
