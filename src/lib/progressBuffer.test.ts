import { afterEach, expect, it, vi } from "vitest";
import { progressBuffer } from "./progressBuffer";
afterEach(() => vi.useRealTimers());
it("coalesces thousands of events per job without losing other jobs", () => {
  vi.useFakeTimers();
  const apply = vi.fn(); const buffer = progressBuffer(apply);
  for (let done = 0; done < 5000; done++) buffer.push({taskId:"a",stage:"下载",done,total:5000});
  buffer.push({taskId:"b",stage:"校验",done:12,total:20});
  expect(apply).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0].map((t: {done:number}) => t.done)).toEqual([4999,12]);
  buffer.dispose();
});
it("finishes immediately and cannot be overwritten by an older pending event", () => {
  vi.useFakeTimers(); const apply = vi.fn(); const buffer = progressBuffer(apply);
  buffer.push({taskId:"a",stage:"下载",done:0,total:1});
  buffer.push({taskId:"a",stage:"任务失败",done:1,total:1,finished:true,error:"失败"});
  expect(apply.mock.calls[0][0][0].finished).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(apply).toHaveBeenCalledTimes(1);
  buffer.dispose();
});
