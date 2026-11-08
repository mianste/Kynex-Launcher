import { useEffect, useRef, type Dispatch, type SetStateAction, type HTMLAttributes } from "react";

type Gesture = { element: HTMLDivElement; pointer: number; x: number; y: number; anchor: number; low: number; high: number; base: Set<string>; active: boolean };
export function useResourceDragSelection(names: string[], selected: string[], setSelected: Dispatch<SetStateAction<string[]>>, disabled: boolean): HTMLAttributes<HTMLDivElement> {
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef<number>();
  const suppressClick = useRef(false);
  const latest = useRef({ names, selected, setSelected });
  latest.current = { names, selected, setSelected };
  function finish() {
    clearTimeout(timer.current); cancelAnimationFrame(frame.current ?? 0);
    const state = gesture.current; gesture.current = null;
    if (state) {
      state.element.closest<HTMLElement>(".pcl-resource-page")?.removeAttribute("data-selecting");
      if (state.element.hasPointerCapture(state.pointer)) state.element.releasePointerCapture(state.pointer);
    }
  }
  useEffect(() => {
    finish(); window.addEventListener("blur", finish);
    return () => { window.removeEventListener("blur", finish); finish(); };
  }, [disabled, names.join("\0")]);
  function updateRange(state: Gesture, index: number) {
    state.low = Math.min(state.low, index); state.high = Math.max(state.high, index);
    const next = new Set(state.base);
    // Restore unrelated selection, clear the visited trail, then select the live anchor range.
    for (let n = state.low; n <= state.high; n++) next.delete(latest.current.names[n]);
    for (let n = Math.min(state.anchor, index); n <= Math.max(state.anchor, index); n++) next.add(latest.current.names[n]);
    latest.current.setSelected((before) => {
      const value = [...next]; return value.length === before.length && value.every((v) => before.includes(v)) ? before : value;
    });
  }
  function atPointer(state: Gesture) {
    const row = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>("[data-resource-name]");
    if (!row || !state.element.contains(row)) return;
    const index = latest.current.names.indexOf(row.dataset.resourceName ?? "");
    if (index >= 0) updateRange(state, index);
  }
  function scroll() {
    const state = gesture.current; if (!state?.active) return;
    let parent = state.element.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      if (state.x >= rect.left && state.x <= rect.right) {
        const delta = state.y < top + 36 ? -10 : state.y > bottom - 36 ? 10 : 0;
        if (delta) { parent.scrollTop += delta; atPointer(state); }
      }
    }
    frame.current = requestAnimationFrame(scroll);
  }
  return {
    onPointerDown(event) {
      suppressClick.current = false;
      if (disabled || event.button !== 0 || (event.target as HTMLElement).closest("button:not(.resource-selection-content),input,a,select,[role=switch]")) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-resource-name]");
      const index = latest.current.names.indexOf(row?.dataset.resourceName ?? "");
      if (index < 0) return;
      finish();
      const state: Gesture = { element: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY,
        anchor: index, low: index, high: index, base: new Set(latest.current.selected), active: false };
      gesture.current = state;
      timer.current = setTimeout(() => {
        if (gesture.current !== state) return;
        state.active = true; state.element.setPointerCapture(state.pointer);
        state.element.closest<HTMLElement>(".pcl-resource-page")?.setAttribute("data-selecting", "true");
        updateRange(state, index); frame.current = requestAnimationFrame(scroll);
      }, 220);
    },
    onPointerMove(event) {
      const state = gesture.current; if (!state || event.pointerId !== state.pointer) return;
      if (!state.active && Math.hypot(event.clientX - state.x, event.clientY - state.y) > 8) { finish(); return; }
      state.x = event.clientX; state.y = event.clientY;
      if (state.active) { event.preventDefault(); atPointer(state); }
    },
    onPointerUp() { suppressClick.current = !!gesture.current?.active; finish(); },
    onPointerCancel() { suppressClick.current = !!gesture.current?.active; finish(); },
    onPointerLeave() { if (!gesture.current?.active) finish(); },
    onLostPointerCapture() { if (gesture.current?.active) { suppressClick.current = true; finish(); } },
    onClickCapture(event) { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } },
    onDragStart(event) { event.preventDefault(); },
  };
}
