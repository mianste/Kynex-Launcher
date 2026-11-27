import { describe, expect, it } from "vitest";
import { resolveWallpaper } from "../src/lib/wallpaper";
const holiday = { holiday: { id: "thanksgiving" } };
describe("壁纸选择", () => {
  it("never uses a cached holiday after the theme switch is off", () => {
    for (const holidayWallpaper of [true, false]) {
      expect(
        resolveWallpaper(
          { wallpaper: "island", holidayThemeEnabled: false, holidayWallpaper },
          holiday,
        ).holidayId,
      ).toBeUndefined();
    }
  });
  it("uses the uploaded picture when holiday wallpaper is disabled", () => {
    const picture = "data:image/png;base64,fixture";
    expect(
      resolveWallpaper({ wallpaper: picture, holidayWallpaper: false }, holiday)
        .src,
    ).toBe(picture);
  });
  it("keeps video as video instead of substituting a static holiday image", () => {
    const result = resolveWallpaper(
      {
        wallpaper: "video:C:/QA/movie.webm",
        holidayThemeEnabled: true,
        holidayWallpaper: true,
      },
      holiday,
    );
    expect(result.kind).toBe("video");
    expect(result.src).toBe("C:/QA/movie.webm");
    expect(result.holidayId).toBeUndefined();
  });
});
