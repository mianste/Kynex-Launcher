import { describe, expect, it } from "vitest";
import { chooseInk, compositeInkBackground } from "../src/lib/adaptiveInk";
describe("adaptive ink stability", () => {
  it("includes the holiday scrim and its animated opacity before selecting text", () => {
    const sample = [[160, 120, 80]];
    compositeInkBackground(sample, [26, 17, 11, 128], 0);
    expect(sample).toEqual([[160, 120, 80]]);
    compositeInkBackground(sample, [26, 17, 11, 128], 1);
    const channels = sample[0]
      .map((value) => value / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    const luminance = channels.reduce(
      (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
      0,
    );
    expect(
      chooseInk(
        undefined,
        1.05 / (luminance + 0.05),
        (luminance + 0.05) / 0.05,
        0,
      ).ink,
    ).toBe("light");
  });
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
