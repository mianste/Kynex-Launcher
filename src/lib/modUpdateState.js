import { create } from "zustand";
// App owns these results, so completion while another page is visible is retained.
export const useModUpdateState = create((set) => ({
  byId: {},
  receive: (event) =>
    set((state) => {
      const old = state.byId[event.id];
      if (old && event.generation < old.generation) return state;
      return {
        byId: {
          ...state.byId,
          [event.id]: {
            generation: event.generation,
            rows: event.rows ?? old?.rows ?? null,
            checking:
              event.status === "checking" ||
              (event.status === "cached" && !!old?.checking),
            error: event.error || "",
          },
        },
      };
    }),
}));
