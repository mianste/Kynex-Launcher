import { create } from "zustand";
export const running = (status) =>
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
export const isBuildRequest = (text) =>
  /(?:制作|搭建|创建|生成|做).{0,60}(?:整合包|冒险包|科技包|轻量包|生存包)/.test(
    text,
  ) && !/(推荐哪些|哪些模组|怎么|如何|搭配建议)/.test(text);
// A queued event can arrive after its record has been deleted.
const deletedRecords = new Set();
export const useAgent = create((set) => ({
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
