import type * as React from "react";
import { type ControlOption, SelectControl } from "./control-select.js";
import type { ControlProps } from "./control-well.js";

/**
 * A paint reference: a well holding a swatch, then the token's name, then the
 * chevron.
 *
 * It is the select with an adornment rather than a second selection
 * mechanism — the swatch is a picture of the value, the list is still the only
 * way to change it, and the picture is supplied by the caller so nothing here
 * decides what a paint looks like.
 */
export function ControlSwatch(
  props: ControlProps & {
    readonly value: string;
    readonly options: readonly ControlOption[];
    readonly swatch: React.ReactNode;
    readonly onChange: (id: string) => void;
  },
): React.JSX.Element {
  const { swatch, ...rest } = props;
  return <SelectControl {...rest} adornment={swatch} />;
}
