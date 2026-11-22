import build from "../../config/build-channel.json";
export const RELEASE = build;
export const RELEASE_SEEN_KEY = `kynex-release-seen-${RELEASE.channel}`;
export function releaseVersionLabel(version) {
  const beta = version.match(/-beta\.(\d+(?:\.\d+)*)$/);
  if (beta) return `beta ${beta[1]}`;
  const stable = version.replace(/^v/, "");
  return `v${stable.replace(/\.0\.0$/, "").replace(/\.0$/, "")}`;
}
