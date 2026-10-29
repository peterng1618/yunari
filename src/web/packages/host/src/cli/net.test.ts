import { type ChildProcess, spawn } from "node:child_process";
import os, { type NetworkInterfaceInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LanSource,
  lanAddress,
  localNames,
  openCommand,
  openTarget,
  rankLanAddresses,
  readLanSource,
  stableName,
  VIRTUAL_ADAPTER_PATTERNS,
} from "./net.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const spawnMock = vi.mocked(spawn);

/** A child that accepts the two calls `openTarget` makes on it. */
function stubSpawn(): {
  on: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
} {
  const child = { on: vi.fn(), unref: vi.fn() };
  spawnMock.mockReturnValue(child as unknown as ChildProcess);
  return child;
}

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

/** A machine with Hyper-V and an Npcap pseudo-adapter: the adapters this
 *  workstation enumerates ahead of its physical NIC, and what `vg-171` is
 *  about. Written out rather than read, so the case passes on a box that has
 *  neither. */
function hyperVFirst(): LanSource["interfaces"] {
  return {
    "Npcap Loopback Adapter": [ipv4("169.254.240.162")],
    "vEthernet (Default Switch)": [ipv4("172.23.96.1")],
    "Loopback Pseudo-Interface 1": [ipv4("127.0.0.1", true)],
    Ethernet: [ipv4("192.168.2.56")],
  };
}

function isVirtual(name: string): boolean {
  return VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name));
}

describe("openCommand", () => {
  it("opens a Windows URL through rundll32, not cmd", () => {
    expect(
      openCommand("https://localhost:5227/editor", { platform: "win32" }),
    ).toEqual({
      file: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://localhost:5227/editor"],
    });
  });

  it("opens a Windows folder through explorer", () => {
    expect(
      openCommand("C:\\Users\\a\\.yunari", {
        platform: "win32",
        directory: true,
      }),
    ).toEqual({ file: "explorer.exe", args: ["C:\\Users\\a\\.yunari"] });
  });

  it.each([
    ["linux", "xdg-open"],
    ["darwin", "open"],
  ] as const)("uses %s's opener", (platform, file) => {
    expect(openCommand("/tmp/yunari", { platform })).toEqual({
      file,
      args: ["/tmp/yunari"],
    });
  });
});

describe("openTarget", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("spawns exactly the command openCommand returns, detached and hidden", () => {
    const child = stubSpawn();
    const target = "C:\\Users\\a\\.yunari";
    const options = { platform: "win32", directory: true } as const;

    expect(openTarget(target, options)).toBe(true);

    const expected = openCommand(target, options);
    expect(spawnMock).toHaveBeenCalledWith(expected.file, expected.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("returns false on a spawn failure rather than throwing", () => {
    spawnMock.mockImplementation(() => {
      throw new Error("no opener here");
    });

    expect(
      openTarget("https://localhost:5227/editor", { platform: "linux" }),
    ).toBe(false);
  });
});

describe("rankLanAddresses", () => {
  it("passes over a virtual switch and a link-local pseudo-adapter ahead of the physical NIC", () => {
    const choice = rankLanAddresses({
      interfaces: hyperVFirst(),
      defaultRouteInterface: undefined,
    });

    // The first non-internal IPv4 in this fixture is Npcap's `169.254.240.162`,
    // which is what the old "first non-internal" rule returned.
    expect(choice.address).toBe("192.168.2.56");
    expect(choice.alternatives).toEqual([]);
  });

  it("names the alternatives when it picks without a default route to go by", () => {
    const choice = rankLanAddresses({
      interfaces: {
        "vEthernet (WSL)": [ipv4("172.20.0.1")],
        Ethernet: [ipv4("192.168.2.56")],
        "Ethernet 2": [ipv4("10.0.0.7")],
      },
      defaultRouteInterface: undefined,
    });

    expect(choice.address).toBe("192.168.2.56");
    expect(choice.alternatives).toEqual(["Ethernet 2 10.0.0.7"]);
  });

  it("prefers the default route even when it is not the first candidate", () => {
    const choice = rankLanAddresses({
      interfaces: {
        Ethernet: [ipv4("10.0.0.7")],
        "Ethernet 2": [ipv4("192.168.1.5")],
      },
      defaultRouteInterface: "Ethernet 2",
    });

    expect(choice.address).toBe("192.168.1.5");
    // The route decided it, so nothing was a guess and nothing is reported.
    expect(choice.alternatives).toEqual([]);
  });

  it("answers one physical adapter exactly as before, route or no route", () => {
    const one = { interfaces: { Ethernet: [ipv4("192.168.2.56")] } };

    expect(
      rankLanAddresses({ ...one, defaultRouteInterface: "Ethernet" }),
    ).toEqual({ address: "192.168.2.56", alternatives: [] });
    expect(
      rankLanAddresses({ ...one, defaultRouteInterface: undefined }),
    ).toEqual({ address: "192.168.2.56", alternatives: [] });
  });

  it("has nothing to offer when only virtual adapters are up", () => {
    const choice = rankLanAddresses({
      interfaces: {
        "vEthernet (Default Switch)": [ipv4("172.23.96.1")],
        "Npcap Loopback Adapter": [ipv4("169.254.240.162")],
      },
      defaultRouteInterface: undefined,
    });

    expect(choice).toEqual({ address: undefined, alternatives: [] });
  });
});

describe("lanAddress", () => {
  it("says on the console which other addresses were in the running", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const address = await lanAddress({
        interfaces: {
          "vEthernet (WSL)": [ipv4("172.20.0.1")],
          Ethernet: [ipv4("192.168.2.56")],
          "Ethernet 2": [ipv4("10.0.0.7")],
        },
        defaultRouteInterface: undefined,
      });

      expect(address).toBe("192.168.2.56");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("Ethernet 2 10.0.0.7");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays quiet when the default route decided the pick", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const address = await lanAddress({
        interfaces: { Ethernet: [ipv4("192.168.2.56")] },
        defaultRouteInterface: "Ethernet",
      });

      expect(address).toBe("192.168.2.56");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("stableName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names this machine the way mDNS does, which is what a display dials", () => {
    vi.spyOn(os, "hostname").mockReturnValue("study-pc");

    // Not a dotted quad: a display's cookie and storage are scoped to the origin
    // it paired on, and the address is the half that DHCP moves.
    expect(stableName()).toBe("study-pc.local");
  });

  it("does not double the suffix on a platform that already answers with it", () => {
    // Linux and macOS `gethostname()` normally do not carry `.local`, but a
    // configuration that sets one would otherwise produce `pc.local.local` —
    // a name nothing answers, which is worse than no name at all.
    vi.spyOn(os, "hostname").mockReturnValue("study-pc.local");

    expect(stableName()).toBe("study-pc.local");
  });

  it("has no name to offer when the platform gives no hostname", () => {
    vi.spyOn(os, "hostname").mockReturnValue("   ");

    // `.local` alone is a name no host answers to, and a reader that dialled it
    // would fail on a phone with nothing on screen to explain why.
    expect(stableName()).toBeNull();
  });
});

describe("localNames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers the name a display dials, as well as the address it falls back to", () => {
    vi.spyOn(os, "hostname").mockReturnValue("study-pc");
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      Ethernet: [ipv4("192.168.2.56")],
    } as ReturnType<typeof os.networkInterfaces>);

    const names = localNames();

    // The leaf's SANs are built from exactly this list (`tls/authority.ts`), so
    // an https dial by the name is a name mismatch the owner cannot tell from a
    // root they had not installed — the trap `0070` exists to remove. Asserted
    // here rather than through a certificate because this is the whole of the
    // host's half; the leaf is `authority.test.ts`'s.
    expect(names).toContain("study-pc.local");
    expect(names).toContain("192.168.2.56");
    expect(names).toContain("localhost");
  });
});

describe("readLanSource", () => {
  it("answers rather than rejects when the adapter list cannot be read", async () => {
    vi.spyOn(os, "networkInterfaces").mockImplementation(() => {
      throw new Error("no adapters for you");
    });

    // `state()` used to be synchronous and could not reject; `/api/hosting` is
    // reached through `void handle(...)` with no catch, so a rejection here
    // would land nowhere. The route comes back unknown and the adapters empty,
    // which `rankLanAddresses` answers as `address: null`.
    await expect(readLanSource()).resolves.toEqual({
      interfaces: {},
      defaultRouteInterface: undefined,
    });
  });
});

describe("VIRTUAL_ADAPTER_PATTERNS", () => {
  it("names every adapter family the ruling lists", () => {
    const dropped = [
      "vEthernet (Default Switch)",
      "vEthernet (WSL)",
      "Hyper-V Virtual Ethernet Adapter",
      "docker0",
      "br-1a2b3c4d5e6f",
      "VirtualBox Host-Only Network",
      "VMware Network Adapter VMnet1",
      "WireGuard Tunnel",
      "tun0",
      "Npcap Loopback Adapter",
    ];

    for (const name of dropped) {
      expect(
        VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name)),
        name,
      ).toBe(true);
    }
  });

  it("leaves the physical adapters this machine enumerates alone", () => {
    for (const name of ["Ethernet", "Ethernet 2", "Wi-Fi", "en0", "eth0"]) {
      expect(
        VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name)),
        name,
      ).toBe(false);
    }
  });

  it("drops the virtual Wi-Fi adapters Windows installs", () => {
    for (const name of [
      "Microsoft Wi-Fi Direct Virtual Adapter",
      "Microsoft Hosted Network Virtual Adapter",
    ]) {
      expect(isVirtual(name), name).toBe(true);
    }
  });

  it("drops Windows' tunnel pseudo-interfaces", () => {
    for (const name of [
      "Tunnel adapter isatap.{1A2B3C4D-0000-0000-0000-000000000000}",
      "Tunnel adapter Teredo Tunneling Pseudo-Interface",
      "Teredo Tunneling Pseudo-Interface",
      "Tunnel adapter 6TO4 Adapter",
    ]) {
      expect(isVirtual(name), name).toBe(true);
    }
  });

  it("drops Linux's tunnel stubs, which the tun/tap pattern misses", () => {
    for (const name of [
      "tunl0",
      "sit0",
      "gre0",
      "gretap0",
      "ip6tnl0",
      "ip6gre0",
    ]) {
      expect(isVirtual(name), name).toBe(true);
    }
  });

  it("still leaves a physical adapter alone beside the new entries", () => {
    for (const name of ["Wi-Fi 2", "wlan0", "enp3s0", "Ethernet 3", "eth1"]) {
      expect(isVirtual(name), name).toBe(false);
    }
  });
});
