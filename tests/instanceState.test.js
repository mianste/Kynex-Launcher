import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/bridge";

vi.mock("../src/lib/bridge", () => ({
  desktop: true,
  api: vi.fn(),
  setGameDirectoryContext: vi.fn(),
}));

let active;
const instances = {
  qa: [{ id: "first" }, { id: "chosen" }],
  other: [{ id: "other-first" }, { id: "other-chosen" }],
};
beforeEach(() => {
  vi.resetModules();
  const values = new Map();
  vi.stubGlobal("location", { hash: "", search: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  vi.stubGlobal("window", { localStorage: globalThis.localStorage });
  active = "qa";
  api.mockImplementation(async (action, payload = {}) => {
    if (action === "select_game_directory") active = payload.directoryId;
    if (["game_directories", "select_game_directory"].includes(action))
      return { activeId: active, items: [{ id: "qa" }, { id: "other" }] };
    if (action === "list_instances") return instances[active];
    if (["list_accounts", "hydrate_pack_icons"].includes(action)) return [];
    return {};
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("实例选择持久化", () => {
  it("restores the last selection from old settings without a saved directory id", async () => {
    localStorage.setItem(
      "kynex-v092",
      JSON.stringify({ version: 9, state: { selected: "chosen" } }),
    );
    const { useStore } = await import("../src/store/index.js");
    await useStore.getState().refresh();
    expect(useStore.getState().selected).toBe("chosen");
    const saved = JSON.parse(localStorage.getItem("kynex-v092")).state;
    expect(saved.directoryId).toBe("qa");
    expect(saved.directorySelections.qa).toBe("chosen");
  });
  it("persists a new selection and keeps it on the next startup", async () => {
    const { useStore } = await import("../src/store/index.js");
    await useStore.getState().refresh();
    useStore.setState({ selected: "chosen" });
    expect(
      JSON.parse(localStorage.getItem("kynex-v092")).state.directorySelections
        .qa,
    ).toBe("chosen");
    vi.resetModules();
    const { useStore: restarted } = await import("../src/store/index.js");
    await restarted.getState().refresh();
    expect(restarted.getState().selected).toBe("chosen");
  });
  it("remembers each directory independently when switching back and forth", async () => {
    const { useStore } = await import("../src/store/index.js");
    await useStore.getState().refresh();
    useStore.setState({ selected: "chosen" });
    await useStore
      .getState()
      .changeDirectory("select_game_directory", { directoryId: "other" });
    expect(useStore.getState().selected).toBe("other-first");
    useStore.setState({ selected: "other-chosen" });
    await useStore
      .getState()
      .changeDirectory("select_game_directory", { directoryId: "qa" });
    expect(useStore.getState().selected).toBe("chosen");
    await useStore
      .getState()
      .changeDirectory("select_game_directory", { directoryId: "other" });
    expect(useStore.getState().selected).toBe("other-chosen");
  });
  it("falls back when the remembered instance no longer exists", async () => {
    localStorage.setItem(
      "kynex-v092",
      JSON.stringify({
        version: 9,
        state: {
          selected: "removed",
          directoryId: "qa",
          directorySelections: { qa: "removed" },
        },
      }),
    );
    const { useStore } = await import("../src/store/index.js");
    await useStore.getState().refresh();
    expect(useStore.getState().selected).toBe("first");
  });
});
