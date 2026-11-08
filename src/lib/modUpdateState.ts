import { create } from "zustand";

export type ModUpdate = {
  file: string;
  status: "update" | "current" | "unknown" | "error";
  detail: string;
  current?: string;
  latest?: string;
  source?: "modrinth" | "curseforge";
  cached?: boolean;
  partial?: boolean;
  warning?: string;
  changelogUrl?: string;
};
export type ModScanEvent = {
  id: string;
  generation: number;
  status: "cached" | "checking" | "done" | "error";
  rows?: ModUpdate[];
  error?: string;
};
type Snapshot = { generation: number; rows: ModUpdate[] | null; checking: boolean; error: string };
// App owns these results, so completion while another page is visible is retained.
export const useModUpdateState = create<{
  byId: Record<string, Snapshot>;
  receive: (event: ModScanEvent) => void;
}>((set) => ({
  byId: {},
  receive: (event) => set((state) => {
    const old = state.byId[event.id];
    if (old && event.generation < old.generation) return state;
    return { byId: { ...state.byId, [event.id]: {
      generation: event.generation,
      rows: event.rows ?? old?.rows ?? null,
      checking: event.status === "checking" || (event.status === "cached" && !!old?.checking),
      error: event.error || "",
    } } };
  }),
}));
