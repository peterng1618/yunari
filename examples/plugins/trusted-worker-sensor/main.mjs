/**
 * A sensor provider in the trusted-worker profile.
 *
 * The host forks this file once and calls `describe` then `sample`. Only the
 * keys a descriptor names are ever asked for, and the vocabulary owns which
 * semantic keys exist — a descriptor for `ram.used.percent` is admitted because
 * that key is declared, not because this file invents it.
 */

import { freemem, totalmem } from "node:os";

const SENSOR_ID = "example-memory:ram";
const SEMANTIC_KEY = "ram.used.percent";

export function describe() {
  return [
    {
      sensorId: SENSOR_ID,
      semanticKey: SEMANTIC_KEY,
      label: "RAM used (example)",
      tier: "baseline",
      unit: "%",
      unitKind: "percent",
    },
  ];
}

export function sample(params) {
  const wanted = Array.isArray(params?.semanticKeys)
    ? params.semanticKeys
    : [];
  if (!wanted.includes(SEMANTIC_KEY)) return [];

  const total = totalmem();
  const now = Number.isFinite(params?.nowMs) ? params.nowMs : Date.now();
  const timestamp = new Date(now).toISOString();

  // An unmeasurable reading is stated as unavailable. Writing zero would tell
  // every theme that the machine is idle.
  if (!(total > 0)) {
    return [
      {
        semanticKey: SEMANTIC_KEY,
        sample: {
          sensorId: SENSOR_ID,
          timestamp,
          status: "unavailable",
          message: "This system did not report its total memory.",
        },
      },
    ];
  }

  const used = ((total - freemem()) / total) * 100;
  return [
    {
      semanticKey: SEMANTIC_KEY,
      sample: {
        sensorId: SENSOR_ID,
        timestamp,
        status: "ok",
        value: Math.min(100, Math.max(0, Math.round(used * 10) / 10)),
        unit: "%",
      },
    },
  ];
}
