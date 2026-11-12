import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlNumber } from "../../components/ui/control-number.js";
import { uiCopy } from "../../ui-copy.js";
import type {
  HostSettingsClient,
  SignalRgbDevice,
  SignalRgbRead,
} from "../client.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/** No faster than this: the receiver's counters change at frame rate and a
 *  settings page has no business asking more often. */
const POLL_INTERVAL_MS = 2_000;

type Answer =
  | { readonly kind: "reading" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "read"; readonly value: SignalRgbRead };

/**
 * The SignalRGB page: whether the receiver listens, which port it will bind,
 * and the devices it publishes.
 *
 * **This is the seam's only user surface.** The bridge itself is headless, so a
 * person cannot otherwise tell that Yunari is the subdevice SignalRGB sees.
 * The page polls its own answer; it does not touch the rest of the Settings
 * controller and cannot hold another page up.
 *
 * The port applies on the next host start. A live rebind would have to replace
 * the socket and its per-device pacing state while frames are in flight, and
 * nothing on the seam needs that yet.
 */
export function SignalRgbPage(props: {
  readonly settings: Pick<
    HostSettingsClient,
    "readSignalRgbBridge" | "saveSignalRgbUdpPort"
  >;
  readonly write: (run: () => Promise<string>) => void;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.signalrgb;
  const [answer, setAnswer] = useState<Answer>({ kind: "reading" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One read now, then one every {@link POLL_INTERVAL_MS} while the page is
   *  mounted. A failed poll leaves the last answer standing where one landed;
   *  a host that never answered says so in one sentence. */
  useEffect(() => {
    let live = true;
    const read = (): void => {
      props.settings.readSignalRgbBridge().then(
        (value) => {
          if (live) setAnswer({ kind: "read", value });
        },
        () => {
          if (!live) return;
          setAnswer((current) =>
            current.kind === "read" ? current : { kind: "unreachable" },
          );
        },
      );
    };

    read();
    const timer = setInterval(read, POLL_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [props.settings]);

  const savePort = (port: number): void => {
    props.write(async () => {
      const saved = await props.settings.saveSignalRgbUdpPort(port);
      if (mounted.current) {
        setAnswer((current) =>
          current.kind === "read"
            ? {
                kind: "read",
                value: {
                  ...current.value,
                  bridge: { ...current.value.bridge, configuredPort: saved },
                },
              }
            : current,
        );
      }
      return copy.savedPort;
    });
  };

  if (answer.kind !== "read") {
    return (
      <Page page="signalrgb">
        <p data-yunari-signalrgb-empty="" className="m-0 text-xs text-muted">
          {answer.kind === "reading" ? copy.reading : copy.unreachable}
        </p>
      </Page>
    );
  }

  const { bridge, devices } = answer.value;

  return (
    <Page page="signalrgb">
      <div className="grid gap-[var(--space-24)] lg:grid-cols-2">
        <Group testId="signalrgb-receiver" name={copy.heading} hint={copy.hint}>
          <p
            data-yunari-signalrgb-state={
              bridge.listening ? "listening" : "stopped"
            }
            className="m-0 text-xs text-muted"
          >
            {bridge.listening && bridge.port !== null
              ? copy.listening(bridge.port)
              : copy.notListening}
          </p>
          {bridge.error === null ? null : (
            <p data-yunari-signalrgb-error="" className="m-0 text-xs text-warn">
              {copy.bindFailed(bridge.error)}
            </p>
          )}
          <ControlNumber
            id="yunari-signalrgb-port"
            label={copy.port}
            value={bridge.configuredPort ?? undefined}
            min={1}
            max={65_535}
            integer
            hint={copy.portHint}
            data={{ "data-yunari-signalrgb-port": "" }}
            {...(bridge.configuredPort === null ? { disabled: true } : {})}
            onCommit={savePort}
          />
          <p className="m-0 text-xs text-muted">{copy.rebindNote}</p>
        </Group>

        {bridge.listening ? (
          <Group
            testId="signalrgb-devices"
            name={copy.devicesHeading}
            hint={copy.devicesHint}
          >
            {devices.length === 0 ? (
              <p className="m-0 text-xs text-muted">{copy.noDevices}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[var(--space-6)] p-0">
                {devices.map((device) => (
                  <DeviceRow key={device.id} device={device} />
                ))}
              </ul>
            )}
          </Group>
        ) : (
          <p className="m-0 text-xs text-muted">{copy.absent}</p>
        )}
      </div>

      <Group testId="signalrgb-add" name={copy.addHeading}>
        <p className="m-0 max-w-[62ch] text-xs text-muted">{copy.addBody}</p>
      </Group>
    </Page>
  );
}

/** One device's row: what SignalRGB sees, and what Yunari drives behind it. */
function DeviceRow(props: {
  readonly device: SignalRgbDevice;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.signalrgb;
  const { device } = props;
  const lighting = device.lighting;
  const channels = lighting?.channels ?? [];

  return (
    <li
      data-yunari-signalrgb-device={device.id}
      className="flex flex-col gap-[var(--space-4)] rounded-lg border border-edge bg-panel-2 p-[var(--space-10)]"
    >
      <span className="text-xs font-semibold text-text">{device.name}</span>
      <span className="text-2xs text-muted">
        {device.id} · {device.kind}
      </span>
      {lighting === undefined ? (
        <span className="text-2xs text-muted">{copy.noLighting}</span>
      ) : (
        <>
          <span className="text-2xs text-muted">
            {[
              copy.deviceLeds(lighting.ledCount),
              copy.deviceLayout(
                lighting.layout.shape,
                lighting.layout.width,
                lighting.layout.height,
              ),
              copy.devicePort(lighting.udpPort),
            ].join(" · ")}
          </span>
          {channels.length === 0 ? null : (
            <span className="text-2xs text-muted">
              {copy.deviceChannels(
                channels
                  .map((channel) => `${channel.name} (${channel.leds})`)
                  .join(", "),
              )}
            </span>
          )}
          <span className="text-2xs text-muted">
            {copy.deviceFrames(lighting.stats.received, lighting.stats.dropped)}
          </span>
        </>
      )}
    </li>
  );
}
