# Trusted-worker sensor template

The host forks `main.mjs` and asks it for a descriptor once, then for the keys a
theme binds. This template reads RAM from `node:os` and reports
`ram.used.percent`.

## The two exports

- **`describe()`** returns the descriptors this provider answers for. A
  descriptor's `semanticKey` must already exist in the vocabulary
  (`packages/renderer-core/src/data/semantic-keys.ts`); the host drops a
  descriptor for any other key, because nothing could ever bind it.
- **`sample({semanticKeys, nowMs, context})`** returns one entry per key it
  answers. Only the keys it owns are asked for.

A reading is `{semanticKey, sample: {sensorId, timestamp, status, value}}`. The
statuses are `ok`, `missing`, `stale`, `error` and `unavailable`. `ok` for a
numeric key needs a finite `value`; text keys need `textValue`, boolean keys
`booleanValue`.

## Do not fabricate

A reading you could not take is `status: "unavailable"` with a sentence in
`message`. A zero is a measurement, so a plugin that cannot read its sensor must
never write one. The host shows the gap and the reason.

## Build and install

```powershell
Compress-Archive -Path examples/plugins/trusted-worker-sensor/* -DestinationPath "$env:TEMP/example-sensor.zip" -Force
```

```sh
(cd examples/plugins/trusted-worker-sensor && zip -r /tmp/example-sensor.zip .)
```

Settings → Extensions → install, approve the `sensor:provide` consent. The
reading appears in the readings picker and can be bound in a theme.

## Change it

- Another key: read its entry in `semantic-keys.ts` and copy its `unit`,
  `unitKind` and value kind into the descriptor and the reading.
- Another host API: `setHostApi((api) => …)` and call `api.call(method, params)`.
  Only the methods listed in the manifest's capabilities are forwarded.
- Two handler throws in one process is a crash, not a retry: the platform stops
  a worker that keeps failing. Return `status: "unavailable"` for an expected
  failure.
