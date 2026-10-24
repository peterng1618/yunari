import { describe, expect, it } from "vitest";
import { parseForegroundLine } from "./foreground.js";

describe("parseForegroundLine", () => {
  it("reads a full line, including class and both window states", () => {
    expect(
      parseForegroundLine(
        '{"kind":"foreground","pid":42,"path":"C:\\\\Games\\\\game.exe","name":"game","class":"UnrealWindow","fullscreen":true,"d3dFullscreen":false}',
      ),
    ).toEqual({
      pid: 42,
      path: "C:\\Games\\game.exe",
      name: "game",
      class: "UnrealWindow",
      fullscreen: true,
      d3dFullscreen: false,
    });
  });

  it("reads an old line with none of the new fields", () => {
    expect(
      parseForegroundLine(
        '{"kind":"foreground","pid":7,"path":"C:\\\\a.exe","name":"a"}',
      ),
    ).toStrictEqual({ pid: 7, path: "C:\\a.exe", name: "a" });
    expect(parseForegroundLine('{"kind":"foreground","pid":0}')).toStrictEqual({
      pid: 0,
    });
  });

  it("drops a non-boolean window state instead of coercing it", () => {
    expect(
      parseForegroundLine(
        '{"kind":"foreground","pid":1,"fullscreen":"true","d3dFullscreen":1}',
      ),
    ).toEqual({ pid: 1 });
    expect(
      parseForegroundLine(
        '{"kind":"foreground","pid":1,"fullscreen":null,"d3dFullscreen":"false"}',
      ),
    ).toEqual({ pid: 1 });
  });

  it("drops a class that is not a non-empty string", () => {
    expect(
      parseForegroundLine('{"kind":"foreground","pid":1,"class":42}'),
    ).toEqual({ pid: 1 });
    expect(
      parseForegroundLine('{"kind":"foreground","pid":1,"class":""}'),
    ).toEqual({ pid: 1 });
  });

  it("does not special-case a frame host; the helper resolves the child", () => {
    expect(
      parseForegroundLine(
        '{"kind":"foreground","pid":100,"class":"ApplicationFrameWindow","fullscreen":false,"d3dFullscreen":false}',
      ),
    ).toEqual({
      pid: 100,
      class: "ApplicationFrameWindow",
      fullscreen: false,
      d3dFullscreen: false,
    });
  });
});
