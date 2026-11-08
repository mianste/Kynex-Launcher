import { describe, expect, it } from "vitest";
import { chooseInk } from "../src/lib/adaptiveInk";

describe("adaptive ink stability", () => {
  it("retains readable ink despite a brighter alternative", () => {
    const initial = chooseInk(undefined, 5, 4, 0);
    expect(chooseInk(initial, 4.6, 8, 3000).ink).toBe("light");
  });
  it("ignores alternating frames and changes after sustained poor contrast", () => {
    let state = chooseInk(undefined, 10, 2, 0);
    for (let time = 2000; time < 5000; time += 200) {
      state = chooseInk(state, 2, 10, time);
      state = chooseInk(state, 10, 2, time + 100);
      expect(state.ink).toBe("light");
    }
    state = chooseInk(state, 2, 10, 5000);
    expect(chooseInk(state, 2, 10, 5599).ink).toBe("light");
    state = chooseInk(state, 2, 10, 5600);
    expect(state.ink).toBe("dark");
    state = chooseInk(state, 10, 2, 5700);
    expect(chooseInk(state, 10, 2, 6500).ink).toBe("dark");
    expect(chooseInk(state, 10, 2, 7400).ink).toBe("light");
  });
});
