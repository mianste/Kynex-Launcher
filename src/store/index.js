import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultInstanceSettings } from "../lib/types";
import { api, desktop, setGameDirectoryContext } from "../lib/bridge";
import { previewInstances } from "../lib/mock";
import { normalizeHexColor } from "../lib/appearance";
import {
  DEFAULT_HOLIDAY_SETTINGS,
  normalizeHolidayDismissed,
  normalizeHolidayRegion,
  normalizeHolidayWindowDays,
} from "../lib/holidays";
import { useModUpdateState } from "../lib/modUpdateState";
export const initialSettings = {
  ...defaultInstanceSettings,
  ...DEFAULT_HOLIDAY_SETTINGS,
  updateMode: "manual",
  checkUpdatesOnStartup: true,
  accent: "#3D7C88",
  wallpaper: "island",
  uiOpacity: 100,
  theme: "light",
  customThemeColor: "#f7fafc",
  clientId: "",
  curseforgeKey: "",
  threads: 8,
  downloadSource: "bmclapi",
  gameLanguage: "zh_cn",
  jvmArgs: "",
  gameArgs: "",
};
const allowed = [
  "home",
  "library",
  "instance",
  "discover",
  "workshop",
  "news",
  "account",
  "skin",
  "diagnose",
  "settings",
  "help",
  "components",
];
const query = new URLSearchParams(location.search).get("page");
const hash = location.hash.slice(1);
let refreshGeneration = 0;
export const useStore = create()(
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
          const result = await api(action, payload);
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
      servers: [],
      page: allowed.includes(hash)
        ? hash
        : allowed.includes(query)
          ? query
          : "home",
      instances: desktop ? [] : previewInstances,
      accounts: [],
      selected: desktop ? "" : "preview-fabric",
      accountId: "",
      selectAccount: (id) => {
        if (get().accounts.some((account) => account.id === id))
          set({ accountId: id });
      },
      settings: initialSettings,
      task: null,
      tasks: {},
      message: "",
      completions: [],
      addCompletions: (items) =>
        set(({ completions }) => ({ completions: [...completions, ...items] })),
      dismissCompletion: (id) =>
        set(({ completions }) => ({
          completions: completions.filter((item) => item.id !== id),
        })),
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
        const dirs = await api("game_directories").catch(() => null);
        if (generation !== refreshGeneration) return;
        const directoryId = Array.isArray(dirs?.items)
          ? dirs.activeId
          : get().directoryId;
        if (directoryId) setGameDirectoryContext(directoryId);
        if (Array.isArray(dirs?.items)) {
          if (get().directoryId !== directoryId)
            useModUpdateState.setState({ byId: {} });
          set({
            directories: dirs.items,
            directoryId,
            ...(get().directoryId !== directoryId
              ? { instances: [], selected: "" }
              : {}),
          });
        }
        await api("download_config", { source: get().settings.downloadSource });
        const instances = await api("list_instances");
        const accounts = await api("list_accounts");
        if (generation !== refreshGeneration) return;
        const remembered = get().directorySelections[directoryId];
        set({
          ...(Array.isArray(dirs?.items)
            ? { directories: dirs.items, directoryId }
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
        void api("hydrate_pack_icons")
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
      version: 9,
      migrate: (persisted, fromVersion) => {
        const old = persisted;
        if (old.settings) delete old.settings.jvm;
        return {
          servers: old.servers ?? [],
          selected: old.selected ?? "",
          directorySelections: old.directorySelections ?? {},
          accountId: old.accountId ?? "",
          skin: old.skin ?? "",
          skinAccountId: old.skinAccountId ?? old.accountId ?? "",
          skinModel: old.skinModel ?? "Classic",
          settings: {
            ...initialSettings,
            ...old.settings,
            jvmArgs:
              typeof old.settings?.jvmArgs === "string"
                ? old.settings.jvmArgs
                : initialSettings.jvmArgs,
            gameArgs:
              typeof old.settings?.gameArgs === "string"
                ? old.settings.gameArgs
                : initialSettings.gameArgs,
            theme:
              old.settings?.theme === "dark" ||
              old.settings?.theme === "system" ||
              old.settings?.theme === "light" ||
              old.settings?.theme === "custom"
                ? old.settings.theme
                : initialSettings.theme,
            customThemeColor:
              normalizeHexColor(old.settings?.customThemeColor) ??
              initialSettings.customThemeColor,
            accent:
              fromVersion < 5 &&
              old.settings?.accent?.toLowerCase() === "#7c5cff"
                ? initialSettings.accent
                : (old.settings?.accent ?? initialSettings.accent),
            downloadSource:
              fromVersion >= 5
                ? (old.settings?.downloadSource ??
                  initialSettings.downloadSource)
                : "bmclapi",
            holidayThemeEnabled:
              typeof old.settings?.holidayThemeEnabled === "boolean"
                ? old.settings.holidayThemeEnabled
                : initialSettings.holidayThemeEnabled,
            holidayRegion: normalizeHolidayRegion(old.settings?.holidayRegion),
            holidayWindowDays: normalizeHolidayWindowDays(
              old.settings?.holidayWindowDays,
            ),
            holidayEffects:
              typeof old.settings?.holidayEffects === "boolean"
                ? old.settings.holidayEffects
                : initialSettings.holidayEffects,
            holidayWallpaper:
              typeof old.settings?.holidayWallpaper === "boolean"
                ? old.settings.holidayWallpaper
                : initialSettings.holidayWallpaper,
            holidayDismissed: normalizeHolidayDismissed(
              old.settings?.holidayDismissed,
            ),
          },
        };
      },
      partialize: (s) => ({
        servers: s.servers,
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
export async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    useStore.getState().notify(String(e).replace(/^Error: /, ""));
  }
}
export async function launch(target) {
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
      ...target,
    });
    s.notify("游戏进程已启动");
  } catch (e) {
    s.notify(String(e));
  } finally {
    useStore.setState({ busy: false });
  }
}
