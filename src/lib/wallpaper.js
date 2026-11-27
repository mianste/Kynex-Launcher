import wallpaper from "../assets/wallpaper-default.jpg";
import { holidayWallpaperUrl } from "./holidayAssets";
import { shouldUseHolidayWallpaper } from "./holidays";

export function resolveWallpaper(settings, holiday) {
  const selected = settings.wallpaper || "island";
  if (selected.startsWith("video:")) {
    const src = selected.slice(6);
    return { key: `video:${src}`, kind: "video", src };
  }
  if (shouldUseHolidayWallpaper(selected, settings, holiday)) {
    const src = holidayWallpaperUrl(holiday.holiday.id);
    return {
      key: `holiday:${holiday.holiday.id}`,
      kind: "image",
      src,
      holidayId: holiday.holiday.id,
    };
  }
  if (selected === "plain") return { key: "plain", kind: "plain", src: "" };
  const src = selected.startsWith("data:") ? selected : wallpaper;
  return {
    key: `${selected === "dusk" ? "dusk" : "image"}:${src}`,
    kind: "image",
    src,
    dusk: selected === "dusk",
    default: selected === "island",
  };
}
