// Offline global holiday calendar and theme resolution engine.

/**
 * Verified Chinese lunar holiday Gregorian dates (Asia/Shanghai, 2020-2040).
 * Format: [month, day] for Spring Festival (1/1), Dragon Boat (5/5), Mid-Autumn (8/15).
 */
const LUNAR_HOLIDAY_TABLE = {
  2020: { springfestival: [1, 25], dragonboat: [6, 25], midautumn: [10, 1] },
  2021: { springfestival: [2, 12], dragonboat: [6, 14], midautumn: [9, 21] },
  2022: { springfestival: [2, 1], dragonboat: [6, 3], midautumn: [9, 10] },
  2023: { springfestival: [1, 22], dragonboat: [6, 22], midautumn: [9, 29] },
  2024: { springfestival: [2, 10], dragonboat: [6, 10], midautumn: [9, 17] },
  2025: { springfestival: [1, 29], dragonboat: [5, 31], midautumn: [10, 6] },
  2026: { springfestival: [2, 17], dragonboat: [6, 19], midautumn: [9, 25] },
  2027: { springfestival: [2, 6], dragonboat: [6, 9], midautumn: [9, 15] },
  2028: { springfestival: [1, 26], dragonboat: [5, 28], midautumn: [10, 3] },
  2029: { springfestival: [2, 13], dragonboat: [6, 16], midautumn: [9, 22] },
  2030: { springfestival: [2, 3], dragonboat: [6, 5], midautumn: [9, 12] },
  2031: { springfestival: [1, 23], dragonboat: [6, 24], midautumn: [10, 1] },
  2032: { springfestival: [2, 11], dragonboat: [6, 12], midautumn: [9, 19] },
  2033: { springfestival: [1, 31], dragonboat: [6, 1], midautumn: [9, 8] },
  2034: { springfestival: [2, 19], dragonboat: [6, 20], midautumn: [9, 27] },
  2035: { springfestival: [2, 8], dragonboat: [6, 10], midautumn: [9, 16] },
  2036: { springfestival: [1, 28], dragonboat: [5, 30], midautumn: [10, 4] },
  2037: { springfestival: [2, 15], dragonboat: [6, 18], midautumn: [9, 24] },
  2038: { springfestival: [2, 4], dragonboat: [6, 7], midautumn: [9, 13] },
  2039: { springfestival: [1, 24], dragonboat: [5, 27], midautumn: [10, 2] },
  2040: { springfestival: [2, 12], dragonboat: [6, 14], midautumn: [9, 20] },
};

const LUNAR_TARGET = {
  springfestival: { month: "1", day: 1 },
  dragonboat: { month: "5", day: 5 },
  midautumn: { month: "8", day: 15 },
};

export const HOLIDAY_WINDOW_CHOICES = [0, 1, 3, 7];

export const DEFAULT_HOLIDAY_SETTINGS = {
  holidayThemeEnabled: true,
  holidayRegion: "global",
  holidayWindowDays: 3,
  holidayEffects: true,
  holidayWallpaper: true,
  holidayDismissed: {},
};

export const HOLIDAYS = [
  {
    id: "christmas",
    name: "圣诞节",
    region: "western",
    priority: 100,
    dateRule: "12月25日",
    accent: { dark: "#e05a54", light: "#c23b3b" },
    secondary: { dark: "#57b887", light: "#2a7b57" },
    gold: "#f2ca74",
  },
  {
    id: "newyear",
    name: "元旦",
    region: "global",
    priority: 95,
    dateRule: "1月1日",
    accent: { dark: "#e8be66", light: "#b58424" },
    secondary: { dark: "#63b7e6", light: "#2c6f9c" },
    gold: "#ffd97d",
  },
  {
    id: "springfestival",
    name: "春节",
    region: "zh",
    priority: 105,
    dateRule: "农历正月初一",
    accent: { dark: "#e85348", light: "#c82d2d" },
    secondary: { dark: "#f2c15a", light: "#b87a14" },
    gold: "#ffd670",
  },
  {
    id: "valentines",
    name: "情人节",
    region: "western",
    priority: 80,
    dateRule: "2月14日",
    accent: { dark: "#eb7aa4", light: "#c74276" },
    secondary: { dark: "#f5a6c2", light: "#df6896" },
    gold: "#ffc2d9",
  },
  {
    id: "easter",
    name: "复活节",
    region: "western",
    priority: 75,
    dateRule: "每年春季周日",
    accent: { dark: "#7ad18a", light: "#368a52" },
    secondary: { dark: "#b692eb", light: "#7a53b8" },
    gold: "#f5d77a",
  },
  {
    id: "mc-anniversary",
    name: "MC 周年日",
    region: "global",
    priority: 85,
    dateRule: "5月17日",
    accent: { dark: "#73c954", light: "#3c8c2a" },
    secondary: { dark: "#c99254", light: "#8b5e34" },
    gold: "#d8ff66",
  },
  {
    id: "dragonboat",
    name: "端午节",
    region: "zh",
    priority: 82,
    dateRule: "农历五月初五",
    accent: { dark: "#57c29e", light: "#1e7f63" },
    secondary: { dark: "#88d47b", light: "#4a8f3e" },
    gold: "#b7ebd1",
  },
  {
    id: "midautumn",
    name: "中秋节",
    region: "zh",
    priority: 92,
    dateRule: "农历八月十五",
    accent: { dark: "#f0c36d", light: "#b57d1d" },
    secondary: { dark: "#779ce0", light: "#3b5f9e" },
    gold: "#ffe196",
  },
  {
    id: "halloween",
    name: "万圣节",
    region: "western",
    priority: 90,
    dateRule: "10月31日",
    accent: { dark: "#f28c38", light: "#c85b12" },
    secondary: { dark: "#a876e8", light: "#6f42b5" },
    gold: "#ffba66",
  },
  {
    id: "thanksgiving",
    name: "感恩节",
    region: "western",
    priority: 78,
    dateRule: "11月第4个周四",
    accent: { dark: "#e29046", light: "#b55d1b" },
    secondary: { dark: "#cf6244", light: "#993d27" },
    gold: "#f5c26b",
  },
];

export const HOLIDAY_BY_ID = Object.fromEntries(
  HOLIDAYS.map((holiday) => [holiday.id, holiday]),
);

const MS_PER_DAY = 86_400_000;

function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function fromDayNumber(number) {
  const date = new Date(number * MS_PER_DAY);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatIsoDate({ year, month, day }) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatChineseMonthDay(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${Number(match[2])}月${Number(match[3])}日`;
}

export function formatHolidayRange(windowStart, windowEnd) {
  if (!windowStart || !windowEnd) return "";
  if (windowStart === windowEnd) return formatChineseMonthDay(windowStart);
  return `${formatChineseMonthDay(windowStart)} – ${formatChineseMonthDay(windowEnd)}`;
}

/**
 * Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday.
 */
export function computeEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/**
 * US Thanksgiving: 4th Thursday of November.
 */
export function computeThanksgiving(year) {
  const nov1Dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - nov1Dow + 7) % 7);
  return { year, month: 11, day: firstThursday + 21 };
}

let cachedLunarFormatter;
const dynamicLunarCache = new Map();

function computeLunarFallback(holidayId, year) {
  const target = LUNAR_TARGET[holidayId];
  if (!target) return null;
  const cacheKey = `${year}-${holidayId}`;
  if (dynamicLunarCache.has(cacheKey)) return dynamicLunarCache.get(cacheKey);
  try {
    cachedLunarFormatter ??= new Intl.DateTimeFormat("en-US-u-ca-chinese", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
    });
    const startMonth =
      holidayId === "springfestival" ? 0 : holidayId === "dragonboat" ? 4 : 7;
    const endMonth =
      holidayId === "springfestival" ? 2 : holidayId === "dragonboat" ? 6 : 10;
    for (let m = startMonth; m <= endMonth; m += 1) {
      for (let day = 1; day <= 31; day += 1) {
        const probe = new Date(Date.UTC(year, m, day, 4, 0, 0));
        if (probe.getUTCMonth() !== m) continue;
        const parts = cachedLunarFormatter.formatToParts(probe);
        let lm = "";
        let ld = 0;
        for (const part of parts) {
          if (part.type === "month") lm = part.value;
          if (part.type === "day") ld = Number(part.value);
        }
        if (lm === target.month && ld === target.day) {
          const found = { year, month: m + 1, day };
          dynamicLunarCache.set(cacheKey, found);
          return found;
        }
      }
    }
  } catch {
    // Fallback unavailable on older runtimes.
  }
  dynamicLunarCache.set(cacheKey, null);
  return null;
}

export function getHolidayDate(holidayId, year) {
  switch (holidayId) {
    case "newyear":
      return { year, month: 1, day: 1 };
    case "valentines":
      return { year, month: 2, day: 14 };
    case "mc-anniversary":
      return { year, month: 5, day: 17 };
    case "halloween":
      return { year, month: 10, day: 31 };
    case "christmas":
      return { year, month: 12, day: 25 };
    case "easter":
      return computeEasterSunday(year);
    case "thanksgiving":
      return computeThanksgiving(year);
    case "springfestival":
    case "dragonboat":
    case "midautumn": {
      const entry = LUNAR_HOLIDAY_TABLE[year]?.[holidayId];
      if (entry) return { year, month: entry[0], day: entry[1] };
      return computeLunarFallback(holidayId, year);
    }
    default:
      return null;
  }
}

export function normalizeHolidayRegion(value) {
  return value === "zh" || value === "western" || value === "global"
    ? value
    : DEFAULT_HOLIDAY_SETTINGS.holidayRegion;
}

export function normalizeHolidayWindowDays(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HOLIDAY_SETTINGS.holidayWindowDays;
  }
  return Math.min(14, Math.max(0, Math.round(value)));
}

export function normalizeHolidayDismissed(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  for (const [key, flag] of Object.entries(value)) {
    if (flag === true && /^\d{4}-[a-z0-9-]+$/i.test(key)) {
      cleaned[key] = true;
    }
  }
  return cleaned;
}

export function holidayMatchesRegion(holiday, region) {
  const normalized = normalizeHolidayRegion(region);
  if (normalized === "global") return true;
  return holiday.region === "global" || holiday.region === normalized;
}

function localCalendarParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

export function resolveActiveHoliday(settings, date = new Date()) {
  if (settings?.holidayThemeEnabled === false) return null;

  const todayParts = localCalendarParts(date);
  const todayNum = dayNumber(todayParts.year, todayParts.month, todayParts.day);
  const windowDays = normalizeHolidayWindowDays(settings?.holidayWindowDays);
  const region = normalizeHolidayRegion(settings?.holidayRegion);
  const dismissed = normalizeHolidayDismissed(settings?.holidayDismissed);
  const candidates = [];

  for (const holiday of HOLIDAYS) {
    if (!holidayMatchesRegion(holiday, region)) continue;
    for (const candidateYear of [
      todayParts.year - 1,
      todayParts.year,
      todayParts.year + 1,
    ]) {
      const hDate = getHolidayDate(holiday.id, candidateYear);
      if (!hDate) continue;
      const hNum = dayNumber(hDate.year, hDate.month, hDate.day);
      const deltaDays = todayNum - hNum;
      if (Math.abs(deltaDays) > windowDays) continue;
      const occurrenceKey = `${hDate.year}-${holiday.id}`;
      if (dismissed[occurrenceKey]) continue;
      candidates.push({
        holiday,
        occurrenceKey,
        holidayDate: formatIsoDate(hDate),
        windowStart: formatIsoDate(fromDayNumber(hNum - windowDays)),
        windowEnd: formatIsoDate(fromDayNumber(hNum + windowDays)),
        deltaDays,
        daysLeft: windowDays - deltaDays + 1,
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const distDiff = Math.abs(a.deltaDays) - Math.abs(b.deltaDays);
    if (distDiff !== 0) return distDiff;
    const prioDiff = b.holiday.priority - a.holiday.priority;
    if (prioDiff !== 0) return prioDiff;
    return a.holiday.id.localeCompare(b.holiday.id);
  });

  return candidates[0];
}

export function findNextHoliday(settings, date = new Date()) {
  const todayParts = localCalendarParts(date);
  const todayNum = dayNumber(todayParts.year, todayParts.month, todayParts.day);
  const region = normalizeHolidayRegion(settings?.holidayRegion);
  const windowDays = normalizeHolidayWindowDays(settings?.holidayWindowDays);
  let best = null;

  for (const holiday of HOLIDAYS) {
    if (!holidayMatchesRegion(holiday, region)) continue;
    for (const candidateYear of [todayParts.year, todayParts.year + 1]) {
      const hDate = getHolidayDate(holiday.id, candidateYear);
      if (!hDate) continue;
      const hNum = dayNumber(hDate.year, hDate.month, hDate.day);
      const startNum = hNum - windowDays;
      if (startNum <= todayNum) continue;
      const daysUntilStart = startNum - todayNum;
      if (!best || daysUntilStart < best.daysUntilStart) {
        best = {
          holiday,
          holidayDate: formatIsoDate(hDate),
          windowStart: formatIsoDate(fromDayNumber(startNum)),
          windowEnd: formatIsoDate(fromDayNumber(hNum + windowDays)),
          daysUntilStart,
          daysUntilHoliday: hNum - todayNum,
        };
      }
    }
  }
  return best;
}

export function shouldUseHolidayWallpaper(wallpaper, settings, activeHoliday) {
  if (settings?.holidayThemeEnabled === false) return false;
  if (!activeHoliday) return false;
  if (settings?.holidayWallpaper === false) return false;
  return !String(wallpaper || "").startsWith("video:");
}

export function msUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0,
  );
  return Math.max(1000, next.getTime() - now.getTime());
}
