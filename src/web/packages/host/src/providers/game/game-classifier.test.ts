import { describe, expect, it, vi } from "vitest";
import type { InstalledGame } from "./catalogue/catalogue.js";
import {
  classifyForeground,
  NON_GAME_PROCESSES,
  type ClassifierReading,
  type ClassifierState,
} from "./game-classifier.js";

function game(
  name: string,
  installDir: string,
  exes: readonly string[] = [],
): InstalledGame {
  return { source: "steam", name, installDir, exes };
}

function state(
  directories: Record<string, readonly string[]> = {},
  fullscreenSamples = 0,
): ClassifierState {
  return {
    fullscreenSamples,
    readdir: async (dir) => {
      const entries = directories[dir];
      if (entries === undefined) throw new Error(`ENOENT: ${dir}`);
      return entries;
    },
  };
}

function reading(overrides: Partial<ClassifierReading>): ClassifierReading {
  return { pid: 4242, ...overrides };
}

describe("classifyForeground", () => {
  describe("catalogue", () => {
    it("matches a path inside the install root", async () => {
      const catalogue = [game("Doom", "C:\\Games\\Doom")];

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Doom\\doom.exe" }),
          catalogue,
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: catalogue[0],
      });
    });

    it("matches by exact executable outside the install root", async () => {
      const catalogue = [
        game("Shared", "C:\\Games\\Shared", ["C:\\Launcher\\shared.exe"]),
      ];

      await expect(
        classifyForeground(
          reading({ path: "c:\\launcher\\SHARED.exe" }),
          catalogue,
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: catalogue[0],
      });
    });

    it("does not match a sibling whose name shares the root as a prefix", async () => {
      const catalogue = [game("Doom", "C:\\Games\\Doom")];

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Doom Eternal\\doom.exe" }),
          catalogue,
          state(),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("prefers an exact executable over an earlier install-root match", async () => {
      const launcher = game("Game Launcher", "C:\\Games\\Game", [
        "C:\\Games\\Game\\launcher.exe",
      ]);
      const target = game("Game", "C:\\Games\\Game", [
        "C:\\Games\\Game\\game.exe",
      ]);

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Game\\game.exe" }),
          [launcher, target],
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: target,
      });
    });

    it("keeps an exact executable first even when containment comes later", async () => {
      const target = game("Game", "C:\\Games\\Game", [
        "C:\\Games\\Game\\game.exe",
      ]);
      const launcher = game("Game Launcher", "C:\\Games\\Game", [
        "C:\\Games\\Game\\launcher.exe",
      ]);

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Game\\game.exe" }),
          [target, launcher],
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: target,
      });
    });

    it("prefers the nested install root over its parent", async () => {
      const parent = game("Parent", "C:\\Games\\Game");
      const nested = game("Nested", "C:\\Games\\Game\\Nested");

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Game\\Nested\\game.exe" }),
          [parent, nested],
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: nested,
      });
    });

    it("does not list markers once the catalogue matches", async () => {
      const readdir = vi.fn(async () => ["steam_api64.dll"]);

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Doom\\doom.exe" }),
          [game("Doom", "C:\\Games\\Doom")],
          { fullscreenSamples: 0, readdir },
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: game("Doom", "C:\\Games\\Doom"),
      });
      expect(readdir).not.toHaveBeenCalled();
    });

    it("matches an appx install root", async () => {
      const catalogue = [
        game(
          "Store Game",
          "C:\\Program Files\\WindowsApps\\StoreGame_1.0.0.0_x64__abc",
        ),
      ];

      await expect(
        classifyForeground(
          reading({
            path: "C:\\Program Files\\WindowsApps\\StoreGame_1.0.0.0_x64__abc\\game.exe",
          }),
          catalogue,
          state(),
        ),
      ).resolves.toEqual({
        running: true,
        evidence: "catalogue",
        game: catalogue[0],
      });
    });
  });

  describe("runtime markers", () => {
    it("reports a marker beside the executable", async () => {
      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Indie\\game.exe" }),
          [],
          state({ "C:\\Games\\Indie": ["steam_api64.dll", "game.exe"] }),
        ),
      ).resolves.toEqual({ running: true, evidence: "runtime" });
    });

    it("matches markers regardless of the listing's case", async () => {
      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Unity\\game.exe" }),
          [],
          state({ "C:\\Games\\Unity": ["UNITYPLAYER.DLL", "Game.exe"] }),
        ),
      ).resolves.toEqual({ running: true, evidence: "runtime" });

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\UE\\game.exe" }),
          [],
          state({ "C:\\Games\\UE": ["GAME.PAK", "ENGINE"] }),
        ),
      ).resolves.toEqual({ running: true, evidence: "runtime" });
    });

    it("requires an Engine directory beside a .pak", async () => {
      const readdir = vi.fn(async () => ["pak0.pak"]);

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\UE\\game.exe" }),
          [],
          { fullscreenSamples: 0, readdir },
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });

      readdir.mockResolvedValue(["pak0.pak", "Engine"]);

      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\UE\\game.exe" }),
          [],
          { fullscreenSamples: 0, readdir },
        ),
      ).resolves.toEqual({ running: true, evidence: "runtime" });
    });

    it("lists the executable's own directory once", async () => {
      const readdir = vi.fn(async () => ["UnityPlayer.dll"]);

      await classifyForeground(
        reading({ path: "C:\\Games\\Unity\\game.exe" }),
        [],
        { fullscreenSamples: 0, readdir },
      );

      expect(readdir).toHaveBeenCalledTimes(1);
      expect(readdir).toHaveBeenCalledWith("C:\\Games\\Unity");
    });

    it("treats a listing failure as no evidence", async () => {
      await expect(
        classifyForeground(
          reading({ path: "C:\\Games\\Missing\\game.exe" }),
          [],
          state(),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });
  });

  describe("window evidence", () => {
    it("needs the fullscreen count to reach the second sample", async () => {
      const candidate = reading({
        path: "C:\\Games\\Unknown\\game.exe",
        class: "UnityWndClass",
        fullscreen: true,
      });

      await expect(
        classifyForeground(candidate, [], state({}, 1)),
      ).resolves.toEqual({ running: false, evidence: "none" });

      await expect(
        classifyForeground(candidate, [], state({}, 2)),
      ).resolves.toEqual({ running: true, evidence: "window" });
    });

    it("accepts the D3D fullscreen flag", async () => {
      await expect(
        classifyForeground(
          reading({
            path: "C:\\Games\\Unknown\\game.exe",
            class: "UnrealWindow",
            d3dFullscreen: true,
          }),
          [],
          state({}, 3),
        ),
      ).resolves.toEqual({ running: true, evidence: "window" });
    });

    it("accepts an Allegro-prefixed class", async () => {
      await expect(
        classifyForeground(
          reading({
            path: "C:\\Games\\Unknown\\game.exe",
            class: "AllegroWndClass",
            fullscreen: true,
          }),
          [],
          state({}, 2),
        ),
      ).resolves.toEqual({ running: true, evidence: "window" });
    });

    it("rejects a class without fullscreen", async () => {
      await expect(
        classifyForeground(
          reading({
            path: "C:\\Games\\Unknown\\game.exe",
            class: "UnityWndClass",
            fullscreen: false,
          }),
          [],
          state({}, 4),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("rejects a fullscreen browser", async () => {
      await expect(
        classifyForeground(
          reading({
            path: "C:\\Program Files\\Google\\Chrome\\chrome.exe",
            name: "chrome",
            class: "Chrome_WidgetWin_1",
            fullscreen: true,
          }),
          [],
          state({}, 4),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("rejects an unresolved ApplicationFrameWindow reading", async () => {
      await expect(
        classifyForeground(
          reading({
            path: "C:\\Windows\\System32\\ApplicationFrameHost.exe",
            name: "ApplicationFrameHost",
            class: "ApplicationFrameWindow",
            fullscreen: true,
          }),
          [],
          state({}, 4),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });
  });

  describe("exclusions and missing readings", () => {
    it("rejects an excluded process even with markers beside it", async () => {
      await expect(
        classifyForeground(
          reading({ path: "C:\\Tools\\node.exe", name: "node" }),
          [],
          state({ "C:\\Tools": ["steam_api64.dll"] }),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("checks the executable's stem, not only the name", async () => {
      await expect(
        classifyForeground(
          reading({ path: "C:\\Windows\\explorer.exe" }),
          [],
          state({ "C:\\Windows": ["UnityPlayer.dll"] }),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("lists every excluded process in lowercase", () => {
      for (const name of NON_GAME_PROCESSES) {
        expect(name).toBe(name.toLowerCase());
      }
    });

    it("returns none for no foreground window", async () => {
      await expect(
        classifyForeground(
          reading({ pid: 0, path: "C:\\Games\\Doom\\doom.exe" }),
          [game("Doom", "C:\\Games\\Doom")],
          state(),
        ),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });

    it("returns none when neither path nor name is known", async () => {
      await expect(
        classifyForeground(reading({ pid: 4242 }), [], state()),
      ).resolves.toEqual({ running: false, evidence: "none" });
    });
  });
});
