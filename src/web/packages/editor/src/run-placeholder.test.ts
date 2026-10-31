import type { Binding, PlanTextSegment, TextRun } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { runPlaceholder, toAuthoringSegments } from "./run-placeholder.js";

const bindings: readonly Binding[] = [
  { id: "cpu", semanticKey: "cpu.load" },
  { id: "unmapped", semanticKey: "gpu.temp" },
];

const value = (bindingId: string): TextRun => ({
  kind: "value",
  bindingId,
  typeToken: "typeTokens.body",
});
const literal = (text: string): TextRun => ({
  kind: "literal",
  text,
  typeToken: "typeTokens.body",
});

describe("the authoring placeholder", () => {
  it("names the token a resolvable run will show", () => {
    expect(runPlaceholder(value("cpu") as never, bindings)).toBe("@cpu.load");
  });

  it("says when the run references a binding the node does not declare", () => {
    const text = runPlaceholder(value("gone") as never, bindings);

    expect(text).toContain("@");
    expect(text).toContain("undeclared");
    expect(text).not.toBe(runPlaceholder(value("cpu") as never, bindings));
  });

  it("marks a declared binding with no reading as unmapped, distinctly", () => {
    const mapped = runPlaceholder(value("unmapped") as never, bindings);
    const unmapped = runPlaceholder(
      value("unmapped") as never,
      bindings,
      "unmapped",
    );

    expect(unmapped).toContain("@gpu.temp");
    expect(unmapped).toContain("unmapped");
    // The three states must not collapse into one another.
    expect(unmapped).not.toBe(mapped);
  });

  it("never reads as a number, so it cannot be mistaken for a sensor value", () => {
    for (const text of [
      runPlaceholder(value("cpu") as never, bindings),
      runPlaceholder(value("gone") as never, bindings),
      runPlaceholder(value("unmapped") as never, bindings, "unmapped"),
    ]) {
      expect(text.startsWith("@")).toBe(true);
      expect(/\d/.test(text)).toBe(false);
    }
  });
});

describe("authoring segments", () => {
  const segments: readonly PlanTextSegment[] = [
    { text: "CPU: ", style: {} },
    { text: "12%", style: {} },
  ];

  it("replaces a value run's text with its token and leaves literals alone", () => {
    const shown = toAuthoringSegments(
      segments,
      [literal("CPU: "), value("cpu")],
      bindings,
    );

    expect(shown[0]?.text).toBe("CPU: ");
    expect(shown[1]?.text).toBe("@cpu.load");
  });

  it("marks a segment that resolved to no reading", () => {
    const gapped: readonly PlanTextSegment[] = [
      { text: "CPU: ", style: {} },
      { text: "—", style: {}, status: "missing" },
    ];

    const shown = toAuthoringSegments(
      gapped,
      [literal("CPU: "), value("cpu")],
      bindings,
    );

    expect(shown[1]?.text).toContain("@cpu.load");
    expect(shown[1]?.text).toContain("unmapped");
  });
});
