/**
 * `lucide-react` keeps each glyph's node array in its own module as
 * `__iconData` and exports it there. The package root re-exports the React
 * components, which wrap the same array in a `forwardRef` object with no way
 * back to it — and a React component is not something a Fabric scene can
 * author, since the scene is geometry. The editor reads the modules instead,
 * so a lucide upgrade moves the starter's icons with it.
 *
 * The package's export map types a deep icon import as its component's default
 * export alone, so `tsconfig.json` maps the subpath here to name the node array
 * the module really exports. The shapes below are the ones `createLucideIcon`
 * consumes. Attributes are the SVG presentation and geometry attributes Lucide
 * emits; a starter icon only reads `d` and the `rect` fields, and the converter
 * refuses anything else.
 */
export const __iconData: {
  readonly name: string;
  readonly size: number;
  readonly node: ReadonlyArray<
    readonly [string, Readonly<Record<string, string | number | undefined>>]
  >;
};
