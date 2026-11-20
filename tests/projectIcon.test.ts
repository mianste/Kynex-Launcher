import { describe, expect, it } from "vitest";
import { coverNeedsThumb, iconPlan, proxyUrl } from "../src/features/download/ProjectIcon";

const cover = "https://oss.pixelmap.cc/pixelmap/covers/user_3_example.webp";
const modIcon = "https://media.forgecdn.net/avatars/thumb/example.png";

describe("资源图标请求顺序", () => {
  it("像素茶艺封面直接请求原图，失败时不先走会返回 400 的公共缩略图代理", () => {
    expect(coverNeedsThumb(cover)).toBe(true);
    const plan = iconPlan(cover);
    expect(plan.src).toBe(cover);
    expect(plan.onError).toBe("cache");
    expect(plan.src).not.toContain("images.weserv.nl");
  });

  it("模组图标仍先请求原地址，失败后再用 96px 代理", () => {
    expect(coverNeedsThumb(modIcon)).toBe(false);
    const plan = iconPlan(modIcon);
    expect(plan.src).toBe(modIcon);
    expect(plan.onError).toBe("proxy");
    expect(proxyUrl(modIcon)).toContain("w=96");
  });
});
