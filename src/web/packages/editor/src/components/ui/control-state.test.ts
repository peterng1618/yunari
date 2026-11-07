import { describe, expect, it } from "vitest";
import {
  CONTROL_STATE_ATTRIBUTE,
  controlStateAttributes,
} from "./control-state.js";

/**
 * The state vocabulary is one attribute and one announcement. The stylesheet's
 * half is read in `editor-shell.control-rules.test.ts`; this is the spelling a
 * control carries.
 */
describe("a control's caller-set state", () => {
  it("carries no attribute at rest", () => {
    expect(controlStateAttributes(undefined)).toEqual({});
  });

  it("announces work in flight as busy", () => {
    expect(controlStateAttributes("busy")).toEqual({
      [CONTROL_STATE_ATTRIBUTE]: "busy",
      "aria-busy": "true",
    });
  });

  it("carries an outcome without inventing an ARIA state", () => {
    expect(controlStateAttributes("success")).toEqual({
      [CONTROL_STATE_ATTRIBUTE]: "success",
    });
    expect(controlStateAttributes("failure")).toEqual({
      [CONTROL_STATE_ATTRIBUTE]: "failure",
    });
  });
});
