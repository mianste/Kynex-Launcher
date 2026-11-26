import christmas from "../assets/holidays/christmas.jpg";
import newyear from "../assets/holidays/newyear.jpg";
import springfestival from "../assets/holidays/springfestival.jpg";
import valentines from "../assets/holidays/valentines.jpg";
import easter from "../assets/holidays/easter.jpg";
import mcAnniversary from "../assets/holidays/mc-anniversary.jpg";
import dragonboat from "../assets/holidays/dragonboat.jpg";
import midautumn from "../assets/holidays/midautumn.jpg";
import halloween from "../assets/holidays/halloween.jpg";
import thanksgiving from "../assets/holidays/thanksgiving.jpg";

export const HOLIDAY_WALLPAPERS = {
  christmas,
  newyear,
  springfestival,
  valentines,
  easter,
  "mc-anniversary": mcAnniversary,
  dragonboat,
  midautumn,
  halloween,
  thanksgiving,
};

export function holidayWallpaperUrl(holidayId) {
  return holidayId ? HOLIDAY_WALLPAPERS[holidayId] ?? null : null;
}
