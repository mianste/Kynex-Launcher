import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Account,
  Instance,
  Page,
  Settings,
  Task,
} from "../lib/types";
import { defaultInstanceSettings } from "../lib/types";
import { api, desktop } from "../lib/bridge";
import { previewInstances } from "../lib/mock";
export const initialSettings: Settings = {
  ...defaultInstanceSettings,
  accent: "#3D7C88",
  wallpaper: "island",
  theme: "light",
  clientId: "",
  curseforgeKey: "",
  threads: 8,
  downloadSource: "bmclapi",
};
interface State {
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
export const useStore = create<State>()(
  persist(
    (set, get) => ({
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
        await api("download_config", { source: get().settings.downloadSource });
        const instances = await api<Instance[]>("list_instances");
        const accounts = await api<Account[]>("list_accounts");
        set({
          instances,
          accounts,
          selected: instances.some((x) => x.id === get().selected)
            ? get().selected
            : (instances[0]?.id ?? ""),
          accountId: accounts.some((x) => x.id === get().accountId)
            ? get().accountId
            : (accounts[0]?.id ?? ""),
        });
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
      version: 5,
      migrate: (persisted) => {
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
            theme:
              old.settings?.theme === "dark" ||
              old.settings?.theme === "system" ||
              old.settings?.theme === "light"
                ? old.settings.theme
                : initialSettings.theme,
            accent:
              old.settings?.accent?.toLowerCase() === "#7c5cff"
                ? initialSettings.accent
                : (old.settings?.accent ?? initialSettings.accent),
            downloadSource: "bmclapi" as const,
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
