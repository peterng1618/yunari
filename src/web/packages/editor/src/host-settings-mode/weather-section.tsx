import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlNumber } from "../components/ui/control-number.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { ControlText } from "../components/ui/control-text.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import {
  type HostSettingsClient,
  isWeatherProvider,
  WEATHER_PROVIDERS,
  type WeatherPlace,
  type WeatherSettings,
} from "./client.js";
import { Group } from "./section-group.js";

/** A message a person can act on: the host's own words where it sent any. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where this PC's weather comes from: the backend, the place, and how often it
 * is polled.
 *
 * **The interval is stored in milliseconds and set in seconds.** A provider
 * polls on a clock, a person sets a cadence; converting at the surface keeps
 * both honest — the route validates the millisecond bounds and the field shows
 * the unit a person would say.
 *
 * **A search fills the place rather than being the place.** Geocoding is a
 * convenience over the three fields the provider reads, so a chosen result
 * fills them and the stored settings are what the provider will later see.
 */
export function WeatherSection(props: {
  readonly settings: HostSettingsClient;
  /** The region's own status writer, which is stable because it is a setter. */
  readonly report: (status: string) => void;
}): React.JSX.Element {
  const { settings, report } = props;
  const [weather, setWeather] = useState<WeatherSettings | undefined>(
    undefined,
  );
  const [search, setSearch] = useState("");
  const [places, setPlaces] = useState<readonly WeatherPlace[]>([]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    settings.readWeather().then(
      (read) => {
        if (live) setWeather(read);
      },
      (error: unknown) => {
        if (live) report(reason(error));
      },
    );
    return () => {
      live = false;
    };
  }, [settings, report]);

  /** One write, the whole object: the route replaces it, so a save of one field
   *  would clear the rest. */
  const save = (next: WeatherSettings): void => {
    report(uiCopy.hostSettings.status.saving);
    void settings.saveWeather(next).then(
      (saved) => {
        if (!mounted.current) return;
        setWeather(saved);
        report(uiCopy.hostSettings.status.savedWeather);
      },
      (error: unknown) => {
        if (mounted.current) {
          report(uiCopy.hostSettings.status.failed(reason(error)));
        }
      },
    );
  };

  const lookUp = (value: string): void => {
    setSearch(value);
    const query = value.trim();
    if (query === "") {
      setPlaces([]);
      return;
    }
    report(uiCopy.hostSettings.weather.searching);
    void settings.searchPlaces(query).then(
      (found) => {
        if (!mounted.current) return;
        setPlaces(found);
        report(
          found.length === 0
            ? uiCopy.hostSettings.weather.noResults
            : uiCopy.hostSettings.status.ready,
        );
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setPlaces([]);
        report(uiCopy.hostSettings.weather.searchFailed(reason(error)));
      },
    );
  };

  return (
    <Group
      testId="weather"
      name={uiCopy.hostSettings.weather.heading}
      hint={uiCopy.hostSettings.weather.hint}
    >
      {weather === undefined ? null : (
        <>
          <ControlSelect
            id="yunari-weather-provider"
            label={uiCopy.hostSettings.weather.provider}
            data={{ "data-yunari-weather-provider": "" }}
            value={weather.provider}
            options={WEATHER_PROVIDERS.map((provider) => ({
              id: provider,
              name: uiCopy.hostSettings.weather.providers[provider],
            }))}
            onChange={(provider) => {
              // The control offers only the three ids, so a fourth cannot reach
              // the host; the guard is what makes that true in the type.
              if (!isWeatherProvider(provider)) return;
              save({ ...weather, provider });
            }}
          />
          <ControlText
            id="yunari-weather-place"
            label={uiCopy.hostSettings.weather.label}
            data={{ "data-yunari-weather-place-field": "" }}
            value={weather.label}
            onCommit={(label) => save({ ...weather, label })}
          />
          <ControlNumber
            id="yunari-weather-latitude"
            label={uiCopy.hostSettings.weather.latitude}
            data={{ "data-yunari-weather-latitude": "" }}
            value={weather.latitude}
            min={-90}
            max={90}
            onCommit={(latitude) => save({ ...weather, latitude })}
          />
          <ControlNumber
            id="yunari-weather-longitude"
            label={uiCopy.hostSettings.weather.longitude}
            data={{ "data-yunari-weather-longitude": "" }}
            value={weather.longitude}
            min={-180}
            max={180}
            onCommit={(longitude) => save({ ...weather, longitude })}
          />
          <ControlToggle
            id="yunari-weather-windows-location"
            label={uiCopy.hostSettings.weather.windowsLocation}
            data={{ "data-yunari-weather-windows-location": "" }}
            checked={weather.useWindowsLocation}
            onChange={(useWindowsLocation) =>
              save({ ...weather, useWindowsLocation })
            }
          />
          <ControlNumber
            id="yunari-weather-interval"
            label={uiCopy.hostSettings.weather.pollInterval}
            data={{ "data-yunari-weather-interval": "" }}
            value={weather.pollIntervalMs / 1000}
            unit={uiCopy.hostSettings.weather.seconds}
            min={60}
            max={86400}
            integer
            onCommit={(seconds) =>
              save({ ...weather, pollIntervalMs: seconds * 1000 })
            }
          />
          <ControlText
            id="yunari-weather-search"
            label={uiCopy.hostSettings.weather.search}
            data={{ "data-yunari-weather-search": "" }}
            value={search}
            onCommit={lookUp}
          />
          {places.length === 0 ? null : (
            <div className="flex flex-col gap-[var(--space-4)]">
              {places.map((place) => (
                <button
                  key={`${place.label}/${place.latitude}/${place.longitude}`}
                  type="button"
                  data-yunari-weather-place={place.label}
                  className={plainButtonClasses}
                  onClick={() => {
                    setPlaces([]);
                    save({
                      ...weather,
                      label: place.label,
                      latitude: place.latitude,
                      longitude: place.longitude,
                    });
                  }}
                >
                  {place.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Group>
  );
}
