import { it, expect } from "vitest";
import { capeFileFromData } from "../src/features/skin/cape";
it("converts native PNG bytes without a CSP-blocked network request", async () => {
  const file=capeFileFromData("data:image/png;base64,iVBORw0KGgo=");
  expect(file.type).toBe("image/png");expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([137,80,78,71,13,10,26,10]);
  expect(()=>capeFileFromData("https://example.com/cape.png")).toThrow();
});
