import { describe, it, expect } from "vitest";
import { releaseVersionLabel } from "../src/lib/release";
describe("public release names", () => {
  it("uses v1 for stable and keeps later patch versions visible", () => {
    expect(releaseVersionLabel("1.0.0")).toBe("v1");
    expect(releaseVersionLabel("1.0.1")).toBe("v1.0.1");
    expect(releaseVersionLabel("1.1.0")).toBe("v1.1");
  });
  it("uses beta labels for developer previews", () => {
    expect(releaseVersionLabel("1.0.0-beta.1")).toBe("beta 1");
    expect(releaseVersionLabel("1.0.0-beta.2")).toBe("beta 2");
    expect(releaseVersionLabel("1.1.0-beta.1.1")).toBe("beta 1.1");
  });
});
