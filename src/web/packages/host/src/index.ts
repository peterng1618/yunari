/**
 * The host's public surface.
 *
 * The wire contract is deliberately **not** re-exported here — it lives in
 * `@yunari/renderer-core` because both the host and every display import it.
 * Re-exporting would invite a second import path for one contract, which is
 * the first step back towards a mirrored pair.
 */

export type { ArgsResult, HostOptions } from "./cli/args.js";

export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  HELP_TEXT,
  isLoopbackHost,
  MAX_PORT_ATTEMPTS,
  parseArgs,
} from "./cli/args.js";

export {
  type ListenableServer,
  lanAddress,
  listenWithFallback,
  localNames,
  openBrowser,
  waitUntilReachable,
} from "./cli/net.js";
export { run } from "./main.js";

export {
  DEFAULT_LHM_URL,
  LHM_DESCRIPTORS,
  LHM_PROVIDER_ID,
  LhmSensorProvider,
} from "./providers/lhm.js";
export { type LhmMatch, matchLhmSensors } from "./providers/lhm-mapping.js";
export {
  flattenLhmSensors,
  type LhmSensor,
} from "./providers/lhm-tree.js";
export {
  LIBRARY_DESCRIPTORS,
  LIBRARY_PROVIDER_ID,
  type LibraryReadings,
  LibrarySensorProvider,
  readingsFromLibrary,
  samplesFromLibrary,
} from "./providers/library.js";
export type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
  SensorTier,
} from "./providers/provider.js";
export type {
  DescribedSensor,
  ProviderFailure,
  SampleCycle,
} from "./providers/registry.js";
export { ProviderRegistry, unionOfKeys } from "./providers/registry.js";
export { contentTypeFor, resolveStaticPath } from "./serve/static-path.js";
export type {
  BundleRoots,
  HostingPeer,
  HostingState,
  HostServer,
  HostServerOptions,
} from "./server.js";
export {
  CA_CERTIFICATE_PATH,
  createHostServer,
  DEFAULT_SAMPLE_INTERVAL_MS,
} from "./server.js";
export {
  createStoreSessionStore,
  type StoreSession,
  type StoreSessionStore,
} from "./settings/store-session.js";
export { createSecureOrigin, type SecureOrigin } from "./tls/authority.js";
export { FrameQueue } from "./transport/frame-queue.js";
export { SseConnection } from "./transport/sse.js";
