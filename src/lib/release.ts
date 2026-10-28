import build from "../../config/build-channel.json";
export const RELEASE = build;
export const RELEASE_SEEN_KEY = `kynex-release-seen-${RELEASE.channel}`;
export function releaseVersionLabel(version: string): string {
  const beta = version.match(/-beta\.(\d+)$/);
  if (beta) return `beta ${beta[1]}`;
  const stable = version.replace(/^v/, "");
  return `v${stable.replace(/\.0\.0$/, "")}`;
}
export type AvailableUpdate = { version: string; notes: string; date?: string };
export type UpdateCheck = {
  status: "unconfigured" | "current" | "available";
  update?: AvailableUpdate;
};
export type UpdateProgress = {
  stage: "downloading" | "verifying" | "installing";
  downloaded: number;
  total: number;
};
