import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { api } from "../src/lib/bridge";
vi.mock("../src/lib/bridge", () => ({ desktop: true, api: vi.fn(), setGameDirectoryContext: vi.fn() }));
let store, launch, preparing, jobs;
beforeEach(async () => {
  vi.resetModules();
  const values = new Map();
  vi.stubGlobal("location", { hash: "", search: "" });
  vi.stubGlobal("localStorage", {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  vi.stubGlobal("window", {localStorage});
  ({useStore:store,launch,launchPreparing:preparing}=await import("../src/store/index.js"));
  store.setState({selected:"first",directoryId:"qa",accountId:"account",instances:[{id:"first",name:"第一个"},{id:"other",name:"另一个"}]});
  jobs=[];api.mockReset();
  api.mockImplementation((action,payload)=>new Promise((resolve,reject)=>jobs.push({action,payload,resolve,reject})));
});
afterEach(()=>vi.unstubAllGlobals());
describe("多版本与同版本启动",()=>{
  it("allows another version to start while one is preparing and keeps independent completion state",async()=>{
    const first=launch();
    expect(preparing(store.getState())).toBe(true);
    store.setState({selected:"other"});
    expect(preparing(store.getState())).toBe(false);
    const other=launch();expect(jobs).toHaveLength(2);
    jobs[0].resolve({pid:1});await first;
    expect(store.getState().busy).toBe(true);expect(preparing(store.getState())).toBe(true);
    jobs[1].resolve({pid:2});await other;
    expect(store.getState().busy).toBe(false);
  });
  it("prevents accidental duplicate clicks during preparation but allows another process after it starts",async()=>{
    const first=launch();await launch();expect(jobs).toHaveLength(1);
    jobs[0].resolve({pid:1});await first;
    const second=launch();expect(jobs).toHaveLength(2);
    jobs[1].resolve({pid:2});await second;
    expect(store.getState().launching).toEqual({});
  });
  it("captures the game directory and releases only the failed request",async()=>{
    const first=launch();store.setState({directoryId:"other-directory"});
    const second=launch();expect(jobs).toHaveLength(2);
    expect(jobs.map(j=>j.payload.directoryId)).toEqual(["qa","other-directory"]);
    jobs[0].reject(new Error("首次启动失败"));await first;
    expect(preparing(store.getState())).toBe(true);expect(store.getState().busy).toBe(true);
    jobs[1].resolve({pid:2});await second;
    expect(store.getState().busy).toBe(false);
  });
});
