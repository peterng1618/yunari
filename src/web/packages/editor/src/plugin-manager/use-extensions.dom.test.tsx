// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import {
  type ClientAnswer,
  type ExtensionClient,
  type ExtensionsState,
  useExtensions,
} from "./use-extensions.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  await act(async () => {
    mounted?.unmount();
  });
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

const HELD = {
  key: "local/acme-sensors",
  name: "Acme Sensors",
  publisher: "local",
  reasons: ["capability:sensor:provide"],
};

function harness(
  client: ExtensionClient,
  save: (state: ExtensionsState) => void,
) {
  return function Harness(): null {
    save(useExtensions(client));
    return null;
  };
}

async function mount(client: ExtensionClient): Promise<() => ExtensionsState> {
  let state: ExtensionsState | undefined;
  const Harness = harness(client, (next) => {
    state = next;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Harness />);
  });
  return () => {
    if (state === undefined) throw new Error("the hook did not mount");
    return state;
  };
}

function clientOf(
  answers: readonly ClientAnswer[],
  installs: { bytes: number[]; approve: boolean | undefined }[],
): ExtensionClient {
  let index = 0;
  return {
    list: async () => [],
    readProviderOrder: async () => ({ version: 1, pluginOrder: [] }),
    install: async (bytes, options) => {
      installs.push({
        bytes: [...bytes],
        approve: options?.approve,
      });
      const answer = answers[index] ?? answers[answers.length - 1];
      index += 1;
      if (answer === undefined) throw new Error("no answer prepared");
      return answer;
    },
    grant: async () => ({ ok: true }),
    remove: async () => undefined,
    writeProviderOrder: async () => ({ ok: true }),
  };
}

it("keeps a held update and its file, then installs it on approval", async () => {
  const installs: { bytes: number[]; approve: boolean | undefined }[] = [];
  const state = await mount(
    clientOf([{ ok: false, held: HELD }, { ok: true }], installs),
  );
  const file = new File([new Uint8Array([1, 2, 3])], "acme.zip");

  await act(async () => {
    await state().install(file);
  });

  expect(state().pendingUpdate?.held).toEqual(HELD);
  // The chosen file is kept while the notice is open: approval re-sends the
  // same bytes rather than asking for the package again.
  expect(state().pendingUpdate?.file).toBe(file);
  expect(state().error).toBeUndefined();
  expect(installs).toEqual([{ bytes: [1, 2, 3], approve: undefined }]);

  await act(async () => {
    await state().approveUpdate();
  });

  expect(installs).toEqual([
    { bytes: [1, 2, 3], approve: undefined },
    { bytes: [1, 2, 3], approve: true },
  ]);
  expect(state().pendingUpdate).toBeUndefined();
});

it("dismisses a held update without installing", async () => {
  const installs: { bytes: number[]; approve: boolean | undefined }[] = [];
  const state = await mount(clientOf([{ ok: false, held: HELD }], installs));
  const file = new File([new Uint8Array([4])], "acme.zip");

  await act(async () => {
    await state().install(file);
  });
  act(() => state().dismissUpdate());

  expect(state().pendingUpdate).toBeUndefined();
  expect(installs).toHaveLength(1);
});
