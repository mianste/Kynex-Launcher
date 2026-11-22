import { api, desktop } from "./bridge";
let detected;
// Keep one result for this app session, including an unsuccessful scan.
export function detectGames(force = false) {
  if (!desktop) return Promise.resolve([]);
  if (!detected || force) {
    detected = api("detect_games").catch(() => []);
  }
  return detected;
}
