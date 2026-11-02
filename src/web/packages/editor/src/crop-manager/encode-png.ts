/** PNG, so a baked crop keeps every visible pixel it had. */
export function encodePng(canvas: HTMLCanvasElement): Uint8Array {
  const url = canvas.toDataURL("image/png");
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error("The baked crop could not be encoded.");
  const binary = atob(url.slice(comma + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
