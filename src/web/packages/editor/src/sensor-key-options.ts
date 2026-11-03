import {
  groupDescriptorsByFamily,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import { uiCopy } from "./ui-copy.js";

/** What this PC says about one reading's key. The first two are the author's
 *  question — is the sensor working — and the third is the honest answer when
 *  the host has not said, or says nothing about a key nobody binds. */
export type SensorKeyStatus = "reporting" | "bound" | "unknown";

/** One entry in the compact reading list. */
export interface SensorKeyOption {
  readonly id: string;
  readonly name: string;
  readonly status: SensorKeyStatus;
  /** True when the host answered that this PC does not measure the key. The
   *  entry stays listed so a reading that works elsewhere is still
   *  recognisable; it is only not a choice here. */
  readonly disabled?: boolean;
}

/**
 * The reading list both the run picker and the inline `@` suggestion offer:
 * catalogue order with no family headings, each key carrying the state its dot
 * shows. A binding the catalogue no longer lists stays at the end under its own
 * spelling, so a saved theme never loses the way back to the key it holds.
 *
 * `measured` absent means the host has not answered; every key is then unknown
 * rather than marked unavailable, which would claim an answer nobody gave.
 * `bound` is every key this theme binds; a key on it that is not measured is
 * the "bound but unavailable" state, and one off it that is not measured is
 * simply unknown here.
 */
export function sensorKeyOptions(
  descriptors: readonly SemanticKeyDescriptor[],
  measured: ReadonlySet<string> | undefined,
  bound: ReadonlySet<string>,
): readonly SensorKeyOption[] {
  const options: SensorKeyOption[] = [];
  const listed = new Set<string>();
  /** `offersChoice` is false for a saved key the catalogue no longer lists: it
   *  is there so the author can return to the binding the document holds, so
   *  the host's answer must not make it unselectable. */
  const optionFor = (
    key: string,
    name: string,
    offersChoice = true,
  ): SensorKeyOption => ({
    id: key,
    name,
    status: sensorKeyStatus(key, measured, bound),
    ...(offersChoice && measured !== undefined && !measured.has(key)
      ? { disabled: true }
      : {}),
  });

  for (const [, family] of groupDescriptorsByFamily(descriptors)) {
    for (const descriptor of family) {
      listed.add(descriptor.key);
      options.push(optionFor(descriptor.key, descriptor.label));
    }
  }
  for (const key of bound) {
    if (!listed.has(key)) options.push(optionFor(key, key, false));
  }
  return options;
}

function sensorKeyStatus(
  key: string,
  measured: ReadonlySet<string> | undefined,
  bound: ReadonlySet<string>,
): SensorKeyStatus {
  if (measured === undefined) return "unknown";
  if (measured.has(key)) return "reporting";
  return bound.has(key) ? "bound" : "unknown";
}

/** The option's accessible name, repeating what its dot shows: colour is the
 *  fast read, and a screen reader cannot use it. */
export function sensorKeyStatusName(
  name: string,
  status: SensorKeyStatus,
): string {
  return `${name}, ${uiCopy.inspectorFields.sensorStatus[status]}`;
}
