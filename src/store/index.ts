import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Account,
  Instance,
  Page,
  Settings,
  Task,
  GameDirectories,
  GameDirectory,
} from "../lib/types";
import { defaultInstanceSettings } from "../lib/types";
import { api, desktop, setGameDirectoryContext } from "../lib/bridge";
import { previewInstances } from "../lib/mock";
import { useModUpdateState } from "../lib/modUpdateState";
export const initialSettings: Settings = {
  ...defaultInstanceSettings,
  updateMode: "manual",
  checkUpdatesOnStartup: true,
  accent: "#3D7C88",
  wallpaper: "island",
  uiOpacity: 0,
  theme: "light",
  clientId: "",
  curseforgeKey: "",
  threads: 8,
  downloadSource: "bmclapi",
  gameLanguage: "zh_cn",
};
interface State {
  directories: GameDirectory[];
  directoryId: string;
  directoryBusy: boolean;
  directorySelections: Record<string, string>;
  changeDirectory: (
    action:
      "add_game_directory" | "select_game_directory" | "remove_game_directory",
    payload: Record<string, unknown>,
  ) => Promise<void>;
  page: Page;
  instances: Instance[];
  accounts: Account[];
  selected: string;
  accountId: string;
  settings: Settings;
  task: Task | null;
  tasks: Record<string, Task>;
  message: string;
  busy: boolean;
  modal: { kind: string; data?: string } | null;
  skin: string;
  skinAccountId: string;
  skinModel: "Classic" | "Slim";
  setPage: (p: Page) => void;
  notify: (s: string) => void;
  show: (kind: string, data?: string) => void;
  hide: () => void;
  refresh: () => Promise<void>;
  updateSettings: (s: Partial<Settings>) => void;
}
const allowed: Page[] = [
  "home",
  "library",
  "instance",
  "discover",
  "news",
  "account",
  "skin",
  "diagnose",
  "settings",
  "help",
  "components",
];
const query = new URLSearchParams(location.search).get("page") as Page;
const hash = location.hash.slice(1) as Page;
let refreshGeneration = 0;
export const useStore = create<State>()(
  persist(
    (set, get) => ({
      directories: [],
      directoryId: "",
      directoryBusy: false,
      directorySelections: {},
      changeDirectory: async (action, payload) => {
        if (get().directoryBusy) return;
        set({ directoryBusy: true });
        ++refreshGeneration;
        const previous = get();
        try {
          const result = await api<GameDirectories>(action, payload);
          if (!Array.isArray(result.items)) throw new Error("无法读取游戏目录");
          setGameDirectoryContext(result.activeId);
          useModUpdateState.setState({ byId: {} });
          set({
            directoryId: result.activeId,
            directories: result.items,
            instances: [],
            selected: "",
            modal: null,
            directorySelections: {
              ...previous.directorySelections,
              [previous.directoryId]: previous.selected,
            },
          });
          await get().refresh();
          void api("scan_installed_mod_updates", {
            curseforgeKey: get().settings.curseforgeKey,
          }).catch(() => {});
        } finally {
          set({ directoryBusy: false });
        }
      },
      page: allowed.includes(hash)
        ? hash
        : allowed.includes(query)
          ? query
          : "home",
      instances: desktop ? [] : previewInstances,
      accounts: [],
      selected: desktop ? "" : "preview-fabric",
      accountId: "",
      settings: initialSettings,
      task: null,
      tasks: {},
      message: "",
      busy: false,
      modal: null,
      skin: "",
      skinAccountId: "",
      skinModel: "Classic",
      setPage: (page) => {
        location.hash = page;
        set({ page });
      },
      notify: (message) => set({ message }),
      show: (kind, data) => set({ modal: { kind, data } }),
      hide: () => set({ modal: null }),
      refresh: async () => {
        if (!desktop) return;
        const generation = ++refreshGeneration;
        const dirs = await api<GameDirectories>("game_directories").catch(
          () => null,
        );
        if (generation !== refreshGeneration) return;
        const directoryId = Array.isArray(dirs?.items)
          ? dirs!.activeId
          : get().directoryId;
        if (directoryId) setGameDirectoryContext(directoryId);
        if (Array.isArray(dirs?.items)) {
          if (get().directoryId !== directoryId)
            useModUpdateState.setState({ byId: {} });
          set({
            directories: dirs!.items,
            directoryId,
            ...(get().directoryId !== directoryId
              ? { instances: [], selected: "" }
              : {}),
          });
        }
        await api("download_config", { source: get().settings.downloadSource });
        const instances = await api<Instance[]>("list_instances");
        const accounts = await api<Account[]>("list_accounts");
        if (generation !== refreshGeneration) return;
        const remembered = get().directorySelections[directoryId];
        set({
          ...(Array.isArray(dirs?.items)
            ? { directories: dirs!.items, directoryId }
            : {}),
          instances,
          accounts,
          selected: instances.some((x) => x.id === get().selected)
            ? get().selected
            : (instances.find((i) => i.id === remembered)?.id ??
              instances[0]?.id ??
              ""),
          accountId: accounts.some((x) => x.id === get().accountId)
            ? get().accountId
            : (accounts[0]?.id ?? ""),
        });
        void api<Instance[]>("hydrate_pack_icons")
          .then((updated) => {
            if (generation !== refreshGeneration) return;
            if (!Array.isArray(updated)) return;
            set((state) => ({
              instances: state.instances.map((current) => {
                const icon = updated.find((i) => i.id === current.id);
                return icon
                  ? {
                      ...current,
                      packIcon: icon.packIcon || current.packIcon,
                      packLogo: icon.packLogo || current.packLogo,
                    }
                  : current;
              }),
            }));
          })
          .catch(() => {});
      },
      updateSettings: (s) => {
        set({ settings: { ...get().settings, ...s } });
        if (desktop && s.downloadSource)
          void api("download_config", { source: s.downloadSource }).catch((e) =>
            get().notify(String(e)),
          );
      },
    }),
    {
      name: "kynex-v092",
      version: 6,
      migrate: (persisted, fromVersion) => {
        const old = persisted as Partial<State>;
        if (old.settings)
          delete (old.settings as unknown as Record<string, unknown>).jvm;
        return {
          selected: old.selected ?? "",
          accountId: old.accountId ?? "",
          skin: old.skin ?? "",
          skinAccountId: old.skinAccountId ?? old.accountId ?? "",
          skinModel: old.skinModel ?? "Classic",
          settings: {
            ...initialSettings,
            ...old.settings,
            // This update enables the requested fully transparent theme once.
            // Later slider changes remain saved normally.
            uiOpacity: 0,
            theme:
              old.settings?.theme === "dark" ||
              old.settings?.theme === "system" ||
              old.settings?.theme === "light"
                ? old.settings.theme
                : initialSettings.theme,
            accent:
              fromVersion < 5 &&
              old.settings?.accent?.toLowerCase() === "#7c5cff"
                ? initialSettings.accent
                : (old.settings?.accent ?? initialSettings.accent),
            downloadSource:
              fromVersion >= 5
                ? (old.settings?.downloadSource ??
                  initialSettings.downloadSource)
                : ("bmclapi" as const),
          },
        };
      },
      partialize: (s) => ({
        settings: s.settings,
        selected: s.selected,
        accountId: s.accountId,
        skin: s.skin,
        skinAccountId: s.skinAccountId,
        skinModel: s.skinModel,
        directorySelections: s.directorySelections,
      }),
    },
  ),
);
export async function guarded(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    useStore.getState().notify(String(e).replace(/^Error: /, ""));
  }
}
export async function launch() {
  const s = useStore.getState();
  if (s.busy) return;
  if (!s.selected) {
    s.show("versions");
    return;
  }
  if (!s.accountId) {
    s.show("login");
    return;
  }
  useStore.setState({
    busy: true,
    task: { stage: "检查环境", done: 0, total: 4 },
  });
  try {
    await api("launch", {
      id: s.selected,
      accountId: s.accountId,
      settings: s.settings,
    });
    s.notify("游戏进程已启动");
  } catch (e) {
    s.notify(String(e));
  } finally {
    useStore.setState({ busy: false });
  }
}
