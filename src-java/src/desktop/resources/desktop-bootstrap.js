(() => {
  try {
    const nativeStorage = window.kynexDesktopStorage;
    const saved = new Map(Object.entries(JSON.parse(nativeStorage("read"))));
    const change = (action, key = "", value = "") => {
      const error = nativeStorage(action, key, value);
      if (error) throw new DOMException(error, "QuotaExceededError");
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() { return saved.size; },
        key: (index) => Array.from(saved.keys())[index] ?? null,
        getItem: (name) => saved.get(String(name)) ?? null,
        setItem(name, proposed) {
          const key = String(name);
          const value = String(proposed);
          change("set", key, value);
          saved.set(key, value);
        },
        removeItem(name) {
          const key = String(name);
          change("remove", key);
          saved.delete(key);
        },
        clear() {
          change("clear");
          saved.clear();
        },
      },
    });
  } catch (error) {
    console.error("读取启动器界面设置失败", error);
  }

  const pending = new Map();
  const callbacks = new Map();
  const events = new Map();
  let sequence = 0;

  window.kynexDesktopReply = ({ id, value, error }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(error);
    else request.resolve(value);
  };
  window.kynexDesktopEvent = (event, payload) => {
    for (const [id, listener] of events) {
      if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
    }
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback, once = false) {
      const id = ++sequence;
      callbacks.set(id, (message) => {
        if (once) callbacks.delete(id);
        callback(message);
      });
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (path) => window.kynexDesktopAsset(String(path)) || "",
    invoke(command, payload = {}) {
      if (command === "plugin:event|listen") {
        const id = ++sequence;
        events.set(id, { event: payload.event, handler: payload.handler });
        return Promise.resolve(id);
      }
      if (command === "plugin:event|unlisten") return Promise.resolve();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          const error = window.kynexDesktopRequest(JSON.stringify({ id, command, payload }));
          if (error) throw new Error(error);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, id) {
      callbacks.delete(events.get(id)?.handler);
      events.delete(id);
    },
  };
  window.isTauri = true;

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.target.closest("[data-tauri-drag-region]")) return;
    const target = event.target;
    let x = event.screenX;
    let y = event.screenY;
    target.setPointerCapture(event.pointerId);
    const move = (pointer) => {
      window.kynexDesktopMove(pointer.screenX - x, pointer.screenY - y);
      x = pointer.screenX;
      y = pointer.screenY;
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("lostpointercapture", () => target.removeEventListener("pointermove", move), { once: true });
  });
})();
