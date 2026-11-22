// Keep the newest event for each job; terminal events always flush immediately.
export function progressBuffer(apply) {
  const pending = new Map();
  let timer;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending.size) return;
    const events = [...pending.values()];
    pending.clear();
    apply(events);
  }
  return {
    push(event) {
      const id = event.taskId;
      if (!id) return;
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
