import { describe, it, expect } from "vitest";
import {
  IdleRotation,
  configureControls,
  nearestTextures,
  CAMERA,
} from "../src/features/skin/viewerCore";
import { validateSkinSize } from "../src/features/skin/skinIO";
import { SkinViewer } from "skinview3d";
import { PerspectiveCamera, Texture, NearestFilter } from "three";
describe("动画", () => {
  it("waits three seconds then accelerates gently, and stops on input", () => {
    const state = { y: 0 };
    const idle = new IdleRotation(state, 0);
    idle.frame(2999, true);
    expect(idle.active).toBe(false);
    idle.frame(3000, true);
    expect(idle.active).toBe(true);
    expect(idle.speed).toBeGreaterThan(0);
    expect(idle.speed).toBeLessThan(0.32);
    expect(state.y).toBeGreaterThan(0);
    idle.activity(4000);
    expect(idle.active).toBe(false);
    expect(idle.speed).toBe(0);
    idle.frame(6999, true);
    expect(idle.active).toBe(false);
    idle.frame(7001, true);
    expect(idle.active).toBe(true);
  });
  it("never rotates during a long drag or when disabled", () => {
    const state = { y: 0 };
    const idle = new IdleRotation(state, 0);
    idle.interacting = true;
    idle.frame(9000, true);
    expect(idle.active).toBe(false);
    expect(state.y).toBe(0);
    idle.interacting = false;
    idle.activity(9001);
    idle.frame(12002, false);
    expect(idle.active).toBe(false);
    expect(state.y).toBe(0);
  });
  it("resumes immediately on explicit enable without jumping after a hidden interval", () => {
    const state = { y: 1 };
    const idle = new IdleRotation(state, 0);
    idle.interacting = true;
    idle.resume(60_000);
    idle.frame(60_016, true);
    expect(idle.active).toBe(true);
    expect(state.y).toBeGreaterThan(1);
    expect(state.y).toBeLessThan(1.01);
    const angle = state.y;
    idle.frame(60_032, false);
    expect(state.y).toBe(angle);
  });
});
describe("旋转 / 缩放 / 纹理过滤", () => {
  it("limits pitch and camera distance while preserving full yaw and touch controls", () => {
    const mock = {
      controls: { mouseButtons: {}, touches: {}, update() {} },
      camera: new PerspectiveCamera(),
      fxaaPass: { enabled: true },
      composer: {
        renderTarget1: { texture: new Texture() },
        renderTarget2: { texture: new Texture() },
      },
    };
    configureControls(mock as unknown as SkinViewer);
    expect(mock.controls).toMatchObject({
      ...CAMERA,
      enablePan: false,
      minAzimuthAngle: -Infinity,
      maxAzimuthAngle: Infinity,
    });
    expect(CAMERA.minPolarAngle).toBeCloseTo(Math.PI / 2 - Math.PI / 6);
    expect(CAMERA.maxPolarAngle).toBeCloseTo(Math.PI / 2 + Math.PI / 6);
    expect(mock.controls.touches).toHaveProperty("TWO");
    expect(mock.composer.renderTarget1.texture.minFilter).toBe(NearestFilter);
    expect(mock.composer.renderTarget2.texture.magFilter).toBe(NearestFilter);
  });
  it("uses nearest sampling without mipmaps for skin, cape and wings", () => {
    const maps = [new Texture(), new Texture(), new Texture()];
    const mock = {
      playerObject: {
        skin: { map: maps[0] },
        cape: { map: maps[1] },
        elytra: { map: maps[2] },
      },
    };
    nearestTextures(mock as unknown as SkinViewer);
    for (const map of maps) {
      expect(map.magFilter).toBe(NearestFilter);
      expect(map.minFilter).toBe(NearestFilter);
      expect(map.generateMipmaps).toBe(false);
    }
  });
});
describe("皮肤导入 PNG layout", () => {
  it("accepts standard, legacy and HD and rejects distorted or excessive images", () => {
    for (const [w, h] of [
      [64, 64],
      [64, 32],
      [128, 128],
      [1024, 512],
    ])
      expect(() => validateSkinSize(w, h)).not.toThrow();
    for (const [w, h] of [
      [32, 32],
      [64, 48],
      [66, 66],
      [192, 192],
      [2048, 2048],
    ])
      expect(() => validateSkinSize(w, h)).toThrow();
  });
});
