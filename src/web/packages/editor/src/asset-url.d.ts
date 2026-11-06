/**
 * `?url` is Vite's own suffix: the file is emitted beside the bundle and the
 * import is the URL that reaches it. The `base: "./"` the editor builds under is
 * what makes that URL correct at both of its mount points.
 */
declare module "*.jpg?url" {
  const url: string;
  export default url;
}

/** A committed package the bundler emits beside the bundle. */
declare module "*.zip?url" {
  const url: string;
  export default url;
}
