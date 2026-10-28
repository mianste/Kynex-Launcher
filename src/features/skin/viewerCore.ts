import { SkinViewer } from "skinview3d";
import { MOUSE, TOUCH, NearestFilter } from "three";
export const CAMERA = {
  minPolarAngle: Math.PI / 3,
  maxPolarAngle: (2 * Math.PI) / 3,
  minDistance: 28,
  maxDistance: 112,
};
export function configureControls(v: SkinViewer) {
  Object.assign(v.controls, CAMERA, {
    enableRotate: true,
    enableZoom: true,
    enablePan: false,
    enableDamping: true,
    dampingFactor: 0.1,
    rotateSpeed: 0.65,
    zoomSpeed: 0.7,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
  });
  v.controls.mouseButtons.LEFT = MOUSE.ROTATE;
  v.controls.mouseButtons.MIDDLE = MOUSE.DOLLY;
  delete v.controls.mouseButtons.RIGHT;
  v.controls.touches.ONE = TOUCH.ROTATE;
  v.controls.touches.TWO = TOUCH.DOLLY_ROTATE;
  v.camera.near = 0.1;
  v.camera.far = 1000;
  v.camera.updateProjectionMatrix();
  // 像素采样：纹理不做线性插值，关闭会软化纹素边缘的后处理。
  v.fxaaPass.enabled = false;
  for (const target of [v.composer.renderTarget1, v.composer.renderTarget2]) {
    target.texture.magFilter = NearestFilter;
    target.texture.minFilter = NearestFilter;
    target.texture.generateMipmaps = false;
  }
  v.controls.update();
}
export function nearestTextures(v: SkinViewer) {
  for (const map of [
    v.playerObject.skin.map,
    v.playerObject.cape.map,
    v.playerObject.elytra.map,
  ]) {
    if (!map) continue;
    map.magFilter = NearestFilter;
    map.minFilter = NearestFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
  }
}
export class IdleRotation {
  lastInput: number;
  lastFrame: number;
  interacting = false;
  constructor(
    private v: Pick<SkinViewer, "autoRotate" | "autoRotateSpeed">,
    now: number,
  ) {
    this.lastInput = this.lastFrame = now;
    v.autoRotate = false;
    v.autoRotateSpeed = 0;
  }
  activity(now: number) {
    this.lastInput = now;
    this.v.autoRotate = false;
    this.v.autoRotateSpeed = 0;
  }
  frame(now: number, enabled: boolean) {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const active = enabled && !this.interacting && now - this.lastInput >= 3000;
    this.v.autoRotate = active;
    this.v.autoRotateSpeed = active
      ? this.v.autoRotateSpeed +
        (0.32 - this.v.autoRotateSpeed) * (1 - Math.exp(-dt / 0.35))
      : 0;
  }
}
export function supportsWebGL(): boolean {
  const canvas = document.createElement("canvas");
  try {
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
