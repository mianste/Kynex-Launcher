import { create } from "zustand";
export type PackResource = {
  source: "modrinth" | "curseforge";
  projectId: string;
  versionId: string;
  name: string;
  side: string;
  reason: string;
  required: boolean;
};
export type PackPlan = {
  version: number;
  name: string;
  minecraft: string;
  loader: { type: string; version: string };
  memoryMb: number;
  java: string;
  mods: PackResource[];
  resourcePacks: PackResource[];
  shaders: PackResource[];
  localization: { mode: string; note: string };
  options: Record<string, unknown>;
  configPatches: {
    file: string;
    format: string;
    set: Record<string, unknown>;
  }[];
  notes: string[];
  estimatedDownloadBytes: number;
  warnings: string[];
};
export type AgentStep = {
  name: string;
  status: string;
  elapsedMs: number;
  detail: string;
  snapshotId: string;
};
export type AgentTask = {
  id: string;
  mode: string;
  status: string;
  request: string;
  plan: PackPlan | null;
  planHash: string;
  steps: AgentStep[];
  currentStep: number;
  budget: Record<string, number>;
  audit: { tool: string; result: string; elapsedMs: number }[];
  createdAt: string;
  updatedAt: string;
  error: string;
  directoryId: string;
  instanceId: string;
  snapshots: string[];
  confirmedHash: string;
  rollbackSnapshot: string;
  results?: Record<string, unknown>;
  maintenance?: boolean;
};
export type AgentEvent = {
  taskId: string;
  type: string;
  task?: AgentTask;
  stage?: string;
  done?: number;
  total?: number;
};
export const running = (status: string) =>
  [
    "classifying",
    "planning",
    "executing",
    "translating",
    "verifying",
    "repairing",
    "updating",
    "migrating",
  ].includes(status);
export const isBuildRequest = (text: string) =>
  /(?:制作|搭建|创建|生成|做).{0,60}(?:整合包|冒险包|科技包|轻量包|生存包)/.test(
    text,
  ) && !/(推荐哪些|哪些模组|怎么|如何|搭配建议)/.test(text);
// A queued event can arrive after its record has been deleted.
const deletedRecords = new Set<string>();
type AgentState = {
  starting: boolean;
  tasks: AgentTask[];
  selected: string;
  error: string;
  progress: Record<string, AgentEvent>;
  remove: (id: string) => void;
  select: (id: string) => void;
  receive: (event: AgentEvent) => void;
  replace: (tasks: AgentTask[]) => void;
  fail: (error: string) => void;
};
export const useAgent = create<AgentState>((set) => ({
  starting: false,
  tasks: [],
  selected: "",
  error: "",
  progress: {},
  remove: (id) => {
    deletedRecords.add(id);
    set((s) => {
      const tasks = s.tasks.filter((t) => t.id !== id);
      const progress = { ...s.progress };
      delete progress[id];
      return {
        tasks,
        progress,
        selected: s.selected === id ? tasks[0]?.id || "" : s.selected,
      };
    });
  },
  select: (selected) => set({ selected, error: "" }),
  fail: (error) => set({ error }),
  replace: (records) =>
    set((s) => {
      const tasks = records.filter((t) => !deletedRecords.has(t.id));
      return {
        tasks,
        selected: tasks.some((t) => t.id === s.selected)
          ? s.selected
          : tasks[0]?.id || "",
      };
    }),
  receive: (event) =>
    set((s) =>
      deletedRecords.has(event.taskId)
        ? s
        : {
            error: "",
            progress:
              event.stage !== undefined ||
              !event.task ||
              !running(event.task.status)
                ? { ...s.progress, [event.taskId]: event }
                : s.progress,
            tasks: event.task
              ? [
                  event.task,
                  ...s.tasks.filter((t) => t.id !== event.taskId),
                ].slice(0, 100)
              : s.tasks,
            selected: s.selected || event.taskId,
          },
    ),
}));
