import { beforeEach, expect, it } from "vitest";
import { useModUpdateState, type ModUpdate } from "./modUpdateState";
const rows: ModUpdate[] = [{ file: "old.jar", status: "update", latest: "2", detail: "可更新" }];
beforeEach(() => useModUpdateState.setState({ byId: {} }));
it("retains off-page results while a newer background check runs or fails", () => {
  const receive = useModUpdateState.getState().receive;
  receive({ id: "a", generation: 1, status: "done", rows });
  receive({ id: "a", generation: 2, status: "checking" });
  expect(useModUpdateState.getState().byId.a).toMatchObject({ rows, checking: true });
  receive({ id: "a", generation: 2, status: "error", error: "离线" });
  expect(useModUpdateState.getState().byId.a).toMatchObject({ rows, checking: false, error: "离线" });
});
it("keeps instance results separate and ignores obsolete completions", () => {
  const receive = useModUpdateState.getState().receive;
  receive({ id: "a", generation: 2, status: "done", rows });
  receive({ id: "b", generation: 1, status: "done", rows: [] });
  receive({ id: "a", generation: 1, status: "done", rows: [] });
  expect(useModUpdateState.getState().byId.a.rows).toEqual(rows);
  expect(useModUpdateState.getState().byId.b.rows).toEqual([]);
});
