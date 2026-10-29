import type { Task } from "./types";

// Keep the newest event for each job; terminal events always flush immediately.
export function progressBuffer(apply: (events: Task[]) => void) {
  const pending = new Map<string, Task>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending.size) return;
    const events = [...pending.values()];
    pending.clear();
    apply(events);
  }
  return {
    push(event: Task) {
      const id = event.taskId || "legacy";
      pending.set(id, { ...pending.get(id), ...event });
      if (event.finished || event.error) flush();
      else if (!timer) timer = setTimeout(flush, 100);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      pending.clear();
    },
  };
}
