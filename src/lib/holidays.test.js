import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOLIDAY_SETTINGS,
  HOLIDAYS,
  computeEasterSunday,
  computeThanksgiving,
  findNextHoliday,
  formatHolidayRange,
  getHolidayDate,
  resolveActiveHoliday,
  shouldUseHolidayWallpaper,
} from "./holidays";

function localDate(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("global holiday theme engine", () => {
  it("activates Christmas from 3 days before to 3 days after and transitions cleanly to New Year", () => {
    expect(resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 12, 21))).toBeNull();

    for (let day = 22; day <= 28; day += 1) {
      const active = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 12, day));
      expect(active?.holiday.id).toBe("christmas");
      expect(active?.occurrenceKey).toBe("2026-christmas");
      expect(active?.windowStart).toBe("2026-12-22");
      expect(active?.windowEnd).toBe("2026-12-28");
      expect(active?.daysLeft).toBe(28 - day + 1);
    }

    // Dec 29 is 3 days before 2027-01-01 New Year's Day
    const dec29 = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 12, 29));
    expect(dec29?.holiday.id).toBe("newyear");
    expect(dec29?.occurrenceKey).toBe("2027-newyear");

    const jan4 = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2027, 1, 4));
    expect(jan4?.holiday.id).toBe("newyear");
    expect(jan4?.daysLeft).toBe(1);

    expect(resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2027, 1, 5))).toBeNull();
  });

  it("computes floating Western and Chinese lunar holidays accurately", () => {
    expect(computeEasterSunday(2026)).toEqual({ year: 2026, month: 4, day: 5 });
    expect(computeEasterSunday(2027)).toEqual({ year: 2027, month: 3, day: 28 });
    expect(computeThanksgiving(2026)).toEqual({ year: 2026, month: 11, day: 26 });
    expect(computeThanksgiving(2027)).toEqual({ year: 2027, month: 11, day: 25 });
    expect(getHolidayDate("springfestival", 2026)).toEqual({ year: 2026, month: 2, day: 17 });
    expect(getHolidayDate("springfestival", 2027)).toEqual({ year: 2027, month: 2, day: 6 });
    expect(getHolidayDate("midautumn", 2026)).toEqual({ year: 2026, month: 9, day: 25 });

    // Feb 14, 2026 is Valentine's Day (delta 0) AND 3 days before Spring Festival (Feb 17, delta -3).
    // Closer distance wins on Feb 14; Spring Festival takes over on Feb 16.
    const feb14 = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 2, 14));
    expect(feb14?.holiday.id).toBe("valentines");
    const feb16 = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 2, 16));
    expect(feb16?.holiday.id).toBe("springfestival");
  });

  it("respects region filters, disable switch, and single-occurrence dismissal", () => {
    const zhOnly = { ...DEFAULT_HOLIDAY_SETTINGS, holidayRegion: "zh" };
    expect(resolveActiveHoliday(zhOnly, localDate(2026, 12, 25))).toBeNull();
    expect(resolveActiveHoliday(zhOnly, localDate(2026, 2, 17))?.holiday.id).toBe("springfestival");

    const disabled = { ...DEFAULT_HOLIDAY_SETTINGS, holidayThemeEnabled: false };
    expect(resolveActiveHoliday(disabled, localDate(2026, 12, 25))).toBeNull();

    // Dismissing 2026-christmas skips 2026 Christmas but still triggers 2027 Christmas
    const dismissed = {
      ...DEFAULT_HOLIDAY_SETTINGS,
      holidayDismissed: { "2026-christmas": true },
    };
    expect(resolveActiveHoliday(dismissed, localDate(2026, 12, 25))).toBeNull();
    expect(resolveActiveHoliday(dismissed, localDate(2027, 12, 25))?.holiday.id).toBe("christmas");
  });

  it("switches default & static image wallpapers to holiday art while preserving video wallpapers", () => {
    const active = resolveActiveHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 12, 25));
    expect(shouldUseHolidayWallpaper("island", DEFAULT_HOLIDAY_SETTINGS, active)).toBe(true);
    expect(shouldUseHolidayWallpaper("data:image/jpeg;base64,abc", DEFAULT_HOLIDAY_SETTINGS, active)).toBe(true);
    expect(shouldUseHolidayWallpaper("video:C:\\wallpapers\\loop.mp4", DEFAULT_HOLIDAY_SETTINGS, active)).toBe(false);
    expect(
      shouldUseHolidayWallpaper("island", { ...DEFAULT_HOLIDAY_SETTINGS, holidayWallpaper: false }, active),
    ).toBe(false);
  });

  it("finds next upcoming holiday and formats ranges cleanly", () => {
    const next = findNextHoliday(DEFAULT_HOLIDAY_SETTINGS, localDate(2026, 12, 1));
    expect(next?.holiday.id).toBe("christmas");
    expect(next?.windowStart).toBe("2026-12-22");
    expect(next?.daysUntilStart).toBe(21);
    expect(formatHolidayRange("2026-12-22", "2026-12-28")).toBe("12月22日 – 12月28日");
    expect(HOLIDAYS.length).toBe(10);
  });
});
