import { useEffect, useRef } from "react";

const DRAG_DISTANCE = 4;
const TOUCH_HOLD = 220;
const SCROLL_EDGE = 36;

function scrollContainer(element) {
  let parent = element.parentElement;
  while (parent) {
    if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function paint(row, selected) {
  row.classList.toggle("selected", selected);
  row.querySelector(".resource-selection-content")?.setAttribute("aria-pressed", String(selected));
}

export function useResourceDragSelection(names, selected, setSelected, disabled) {
  const gesture = useRef(null);
  const suppressClick = useRef(false);

  function finish(commit = false) {
    const state = gesture.current;
    if (!state) return;
    gesture.current = null;
    clearTimeout(state.hold);
    cancelAnimationFrame(state.frame);
    if (!state.rows) return;
    if (!commit) {
      for (let index = state.low; index <= state.high; index++) {
        const name = state.names[index];
        if (state.preview.has(name) !== state.base.has(name))
          paint(state.rows[index], state.base.has(name));
      }
    }
    state.panel?.removeAttribute("data-selecting");
    if (state.element.hasPointerCapture(state.pointer))
      state.element.releasePointerCapture(state.pointer);
    if (commit) setSelected([...state.preview]);
  }

  useEffect(() => {
    const cancel = () => finish();
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [disabled, names.join("\0")]);

  function updateRange(state, index) {
    if (index === state.last) return;
    state.low = Math.min(state.low, index);
    state.high = Math.max(state.high, index);
    state.last = index;
    const start = Math.min(state.anchor, index);
    const end = Math.max(state.anchor, index);
    // Preview the changed rows directly. Commit the range once on pointer release.
    for (let cursor = state.low; cursor <= state.high; cursor++) {
      const name = state.names[cursor];
      const checked = start <= cursor && cursor <= end;
      if (state.preview.has(name) === checked) continue;
      if (checked) state.preview.add(name);
      else state.preview.delete(name);
      paint(state.rows[cursor], checked);
    }
    if (state.count) state.count.textContent = `已选择 ${state.preview.size} 个文件`;
  }

  function atPointer(state) {
    const row = document.elementFromPoint(state.x, state.y)?.closest("[data-resource-name]");
    const index = state.positions.get(row);
    if (index !== undefined) updateRange(state, index);
  }

  function schedule(state) {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      if (gesture.current !== state) return;
      const parent = state.scrollParent;
      const bounds = state.scrollBounds;
      let moved = false;
      if (bounds && state.x >= bounds.left && state.x <= bounds.right) {
        const above = Math.max(0, Math.max(0, bounds.top) + SCROLL_EDGE - state.y);
        const below = Math.max(0, state.y - Math.min(innerHeight, bounds.bottom) + SCROLL_EDGE);
        const amount = Math.max(-18, Math.min(18, (below - above) * 0.45));
        if (amount) {
          const before = parent.scrollTop;
          parent.scrollTop += amount;
          moved = parent.scrollTop !== before;
        }
      }
      atPointer(state);
      if (moved) schedule(state);
    });
  }

  function begin(state) {
    const rows = new Map([...state.element.querySelectorAll("[data-resource-name]")]
      .map((row) => [row.dataset.resourceName, row]));
    state.rows = state.names.map((name) => rows.get(name));
    if (state.rows.some((row) => !row)) {
      state.rows = null;
      finish();
      return;
    }
    state.positions = new Map(state.rows.map((row, index) => [row, index]));
    state.scrollParent = scrollContainer(state.element);
    state.scrollBounds = state.scrollParent?.getBoundingClientRect();
    state.panel = state.element.closest(".pcl-resource-page");
    state.count = state.panel?.querySelector(".resource-drag-count");
    state.element.setPointerCapture(state.pointer);
    state.panel?.setAttribute("data-selecting", "true");
    updateRange(state, state.anchor);
    schedule(state);
  }

  return {
    onPointerDown(event) {
      if (event.isPrimary) suppressClick.current = false;
      if (
        disabled || !event.isPrimary || event.button !== 0 ||
        event.target.closest("button:not(.resource-selection-content),input,a,select,[role=switch]")
      ) return;
      const row = event.target.closest("[data-resource-name]");
      const anchor = names.indexOf(row?.dataset.resourceName ?? "");
      if (anchor < 0) return;
      finish();
      const state = {
        element: event.currentTarget,
        pointer: event.pointerId,
        touch: event.pointerType === "touch",
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        anchor,
        low: anchor,
        high: anchor,
        names,
        base: new Set(selected),
        preview: new Set(selected),
      };
      gesture.current = state;
      if (state.touch) state.hold = setTimeout(() => begin(state), TOUCH_HOLD);
    },
    onPointerMove(event) {
      const state = gesture.current;
      if (!state || event.pointerId !== state.pointer) return;
      state.x = event.clientX;
      state.y = event.clientY;
      if (!state.rows) {
        if (Math.hypot(state.x - state.startX, state.y - state.startY) < DRAG_DISTANCE) return;
        if (state.touch) finish();
        else begin(state);
      } else schedule(state);
    },
    onPointerUp(event) {
      const state = gesture.current;
      if (!state || state.pointer !== event.pointerId) return;
      if (state.rows) {
        state.x = event.clientX;
        state.y = event.clientY;
        atPointer(state);
        suppressClick.current = true;
      }
      finish(true);
    },
    onPointerCancel() { finish(); },
    onPointerLeave() {
      if (!gesture.current?.rows) finish();
    },
    onLostPointerCapture() { finish(); },
    onClickCapture(event) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart(event) { event.preventDefault(); },
  };
}
