/** Lifecycle and cancellable image loading reference: Amethyst SkinViewer3D.tsx (MIT). See docs/SKIN-REFERENCE.md. */
import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  SkinViewer,
  WalkingAnimation,
  RunningAnimation,
  FlyingAnimation,
  IdleAnimation,
} from "skinview3d";
import { loadSkinToCanvas } from "skinview-utils";
import { NearestFilter } from "three";
import type { ModelChoice, SkinModel } from "./skinIO";
import {
  CAMERA,
  configureControls,
  nearestTextures,
  IdleRotation,
  supportsWebGL,
} from "./viewerCore";
export type SkinMotion = "站立" | "行走" | "奔跑" | "飞行" | "静止";
export interface ViewerHandle {
  face: (back: boolean) => void;
  reset: () => void;
  magnify: (factor: number) => void;
}
interface Props {
  texture: string;
  model: ModelChoice;
  motion: SkinMotion;
  rotate: boolean;
  outer: boolean;
  cape: HTMLCanvasElement | null;
  equipment?: "cape" | "elytra";
  zoom?: number;
  mode: "3D" | "2D";
  onUnavailable: () => void;
  onLoaded: () => void;
  onModel?: (model: SkinModel) => void;
  onError?: (message: string) => void;
}
export const MinecraftViewer = forwardRef<ViewerHandle, Props>(
  function MinecraftViewer(
    {
      texture,
      model,
      motion,
      rotate,
      outer,
      cape,
      equipment = "cape",
      zoom = 0.8,
      mode,
      onUnavailable,
      onLoaded,
      onModel,
      onError,
    },
    ref,
  ) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const viewer = useRef<SkinViewer | null>(null);
    const idle = useRef<IdleRotation | null>(null);
    const liveOptions = useRef({ rotate, mode });
    liveOptions.current = { rotate, mode };
    const [ready, Ready] = useState(false);
    const [reduced, Reduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const activity = () => idle.current?.activity(performance.now());
    const report = () => {
      const v = viewer.current,
        h = host.current;
      if (!v || !h) return;
      h.dataset.autoRotate = String(idle.current?.active ?? false);
      h.dataset.rotation = String(v.playerWrapper.rotation.y);
      h.dataset.distance = String(v.controls.getDistance());
      h.dataset.polarAngle = String(v.controls.getPolarAngle());
      h.dataset.equipment = v.playerObject.backEquipment ?? "none";
      h.dataset.model = v.playerObject.skin.modelType;
      h.dataset.nearest = String(
        v.playerObject.skin.map?.magFilter === NearestFilter,
      );
    };
    useImperativeHandle(
      ref,
      () => ({
        face(back) {
          const v = viewer.current;
          if (!v) return;
          activity();
          const distance = Math.max(
            CAMERA.minDistance,
            Math.min(CAMERA.maxDistance, v.controls.getDistance()),
          );
          v.playerWrapper.rotation.y = 0;
          v.playerObject.rotation.set(0, 0, 0);
          v.camera.position.set(0, 0, back ? -distance : distance);
          v.controls.update();
          report();
        },
        reset() {
          const v = viewer.current;
          if (!v) return;
          activity();
          v.playerWrapper.rotation.y = 0;
          v.playerObject.rotation.set(0, 0, 0);
          v.controls.target.set(0, 0, 0);
          v.camera.position.set(24, 9, 52);
          v.zoom = zoom;
          v.controls.update();
          report();
        },
        magnify(factor) {
          const v = viewer.current;
          if (!v) return;
          activity();
          const offset = v.camera.position.clone().sub(v.controls.target);
          offset.setLength(
            Math.max(
              CAMERA.minDistance,
              Math.min(CAMERA.maxDistance, offset.length() * factor),
            ),
          );
          v.camera.position.copy(v.controls.target).add(offset);
          v.controls.update();
          report();
        },
      }),
      [zoom],
    );
    useEffect(() => {
      if (!canvas.current || !host.current) return;
      const c = canvas.current,
        h = host.current;
      if (!supportsWebGL()) {
        onUnavailable();
        return;
      }
      let v: SkinViewer | undefined,
        resize: ResizeObserver | undefined,
        frame = 0,
        disposed = false;
      const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
      const changed = () => Reduced(motionQuery.matches);
      const contextLost = (e: Event) => {
        e.preventDefault();
        if (v) v.renderPaused = true;
        cancelAnimationFrame(frame);
        onUnavailable();
      };
      const start = () => {
        if (idle.current) idle.current.interacting = true;
        activity();
      };
      const end = () => {
        if (!idle.current?.interacting) return;
        if (idle.current) idle.current.interacting = false;
        // skinview3d 只监听画布上的 mouseup；在画布外松开也要结束它的拖动状态。
        c.dispatchEvent(new MouseEvent("mouseup"));
        activity();
      };
      const touch = () => activity();
      const moved = (e: PointerEvent) => {
        if (e.buttons) activity();
        else if (idle.current?.interacting) end();
      };
      const visibility = () => {
        if (v)
          v.renderPaused = document.hidden || liveOptions.current.mode === "2D";
        end();
        if (
          !document.hidden &&
          liveOptions.current.mode === "3D" &&
          liveOptions.current.rotate
        )
          idle.current?.resume(performance.now());
      };
      try {
        v = new SkinViewer({
          canvas: c,
          width: Math.max(1, h.clientWidth),
          height: Math.max(1, h.clientHeight),
          model: "auto-detect",
          fov: 55,
          zoom,
          pixelRatio: Math.min(devicePixelRatio || 1, 2),
          enableControls: true,
          preserveDrawingBuffer: false,
          renderPaused: mode === "2D",
        });
        viewer.current = v;
        v.playerObject.skin.visible = false;
        v.globalLight.intensity = 1.7;
        v.cameraLight.intensity = 0.6;
        v.camera.position.set(24, 9, 52);
        v.adjustCameraDistance();
        configureControls(v);
        nearestTextures(v);
        // Own the yaw in one frame loop. skinview3d's separate mouse flag can
        // remain set after a drag ends outside its canvas and block autoRotate.
        v.autoRotate = false;
        idle.current = new IdleRotation(
          v.playerWrapper.rotation,
          performance.now(),
        );
        if (liveOptions.current.rotate) idle.current.resume(performance.now());
        v.controls.addEventListener("start", start);
        v.controls.addEventListener("end", end);
        v.controls.addEventListener("change", report);
        c.addEventListener("pointerdown", touch);
        c.addEventListener("pointermove", moved);
        c.addEventListener("wheel", touch, { passive: true });
        c.addEventListener("webglcontextlost", contextLost);
        document.addEventListener("visibilitychange", visibility);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("blur", end);
        window.addEventListener("focus", visibility);
        c.addEventListener("lostpointercapture", end);
        motionQuery.addEventListener("change", changed);
        let reported = 0;
        const update = (now: number) => {
          if (disposed || !v) return;
          idle.current?.frame(
            now,
            liveOptions.current.rotate &&
              liveOptions.current.mode === "3D" &&
              !document.hidden,
          );
          if (now - reported > 200) {
            report();
            reported = now;
          }
          frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
        resize = new ResizeObserver(([entry]) => {
          if (
            !disposed &&
            v &&
            entry.contentRect.width &&
            entry.contentRect.height
          ) {
            v.setSize(entry.contentRect.width, entry.contentRect.height);
            v.controls.update();
          }
        });
        resize.observe(h);
        Ready(true);
        report();
      } catch {
        v?.dispose();
        v?.renderer.forceContextLoss();
        viewer.current = null;
        onUnavailable();
      }
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        resize?.disconnect();
        motionQuery.removeEventListener("change", changed);
        c.removeEventListener("pointerdown", touch);
        c.removeEventListener("pointermove", moved);
        c.removeEventListener("wheel", touch);
        c.removeEventListener("webglcontextlost", contextLost);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("blur", end);
        window.removeEventListener("focus", visibility);
        c.removeEventListener("lostpointercapture", end);
        v?.controls.removeEventListener("start", start);
        v?.controls.removeEventListener("end", end);
        v?.controls.removeEventListener("change", report);
        v?.dispose();
        v?.renderer.forceContextLoss();
        viewer.current = null;
        idle.current = null;
      };
    }, [onUnavailable]);
    useEffect(() => {
      const v = viewer.current;
      if (!v || !ready) return;
      let active = true;
      const image = new Image();
      image.src = texture;
      image
        .decode()
        .then(() => {
          if (!active || v.disposed) return;
          v.loadSkin(image, {
            model:
              model === "Auto"
                ? "auto-detect"
                : model === "Slim"
                  ? "slim"
                  : "default",
          });
          nearestTextures(v);
          v.playerObject.skin.setOuterLayerVisible(outer);
          onModel?.(
            v.playerObject.skin.modelType === "slim" ? "Slim" : "Classic",
          );
          idle.current?.resume(performance.now());
          report();
          v.render();
          onLoaded();
        })
        .catch(() => {
          if (active) onError?.("皮肤图片未能解码，请重新导入 PNG");
        });
      return () => {
        active = false;
      };
    }, [texture, model, ready, onLoaded, onUnavailable, onModel, onError]);
    useEffect(() => {
      const v = viewer.current;
      if (v && ready) {
        v.playerObject.skin.setOuterLayerVisible(outer);
        report();
      }
    }, [outer, ready]);
    useEffect(() => {
      const v = viewer.current;
      if (!v || !ready) return;
      if (cape) v.loadCape(cape, { backEquipment: equipment });
      else v.loadCape(null);
      nearestTextures(v);
      report();
    }, [cape, equipment, ready]);
    useEffect(() => {
      const v = viewer.current;
      if (!v || !ready) return;
      v.animation =
        reduced || motion === "静止"
          ? null
          : motion === "行走"
            ? new WalkingAnimation()
            : motion === "奔跑"
              ? new RunningAnimation()
              : motion === "飞行"
                ? new FlyingAnimation()
                : new IdleAnimation();
    }, [motion, ready, reduced]);
    useEffect(() => {
      const v = viewer.current;
      if (v && ready) {
        v.renderPaused = mode === "2D" || document.hidden;
        if (rotate && mode === "3D" && !document.hidden)
          idle.current?.resume(performance.now());
      }
    }, [mode, ready, rotate]);
    return (
      <div
        className="wardrobe-canvas"
        ref={host}
        style={{ visibility: mode === "2D" ? "hidden" : undefined }}
      >
        <canvas
          ref={canvas}
          aria-label="3D 皮肤预览"
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  },
);
export function FlatSkin({
  texture,
  slim,
  outer,
}: {
  texture: string;
  slim: boolean;
  outer: boolean;
}) {
  const front = useRef<HTMLCanvasElement>(null),
    back = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    const image = new Image();
    image.src = texture;
    image
      .decode()
      .then(() => {
        if (!active) return;
        const source = document.createElement("canvas");
        loadSkinToCanvas(source, image);
        const scale = source.width / 64;
        for (const [canvas, isBack] of [
          [front.current, false],
          [back.current, true],
        ] as const) {
          if (!canvas) continue;
          canvas.width = 16 * scale;
          canvas.height = 32 * scale;
          const g = canvas.getContext("2d")!;
          g.imageSmoothingEnabled = false;
          const w = slim ? 3 : 4;
          const draw = (
            u: number,
            v: number,
            sw: number,
            sh: number,
            x: number,
            y: number,
          ) =>
            g.drawImage(
              source,
              u * scale,
              v * scale,
              sw * scale,
              sh * scale,
              x * scale,
              y * scale,
              sw * scale,
              sh * scale,
            );
          draw(isBack ? 24 : 8, 8, 8, 8, 4, 0);
          draw(isBack ? 32 : 20, 20, 8, 12, 4, 8);
          draw(isBack ? 12 : 4, 20, 4, 12, isBack ? 8 : 4, 20);
          draw(isBack ? 28 : 20, 52, 4, 12, isBack ? 4 : 8, 20);
          draw(isBack ? 48 + w : 44, 20, w, 12, isBack ? 12 : 4 - w, 8);
          draw(isBack ? 40 + w : 36, 52, w, 12, isBack ? 4 - w : 12, 8);
          if (outer) {
            draw(isBack ? 56 : 40, 8, 8, 8, 4, 0);
            draw(isBack ? 32 : 20, 36, 8, 12, 4, 8);
            draw(isBack ? 12 : 4, 36, 4, 12, isBack ? 8 : 4, 20);
            draw(isBack ? 12 : 4, 52, 4, 12, isBack ? 4 : 8, 20);
            draw(isBack ? 48 + w : 44, 36, w, 12, isBack ? 12 : 4 - w, 8);
            draw(isBack ? 56 + w : 52, 52, w, 12, isBack ? 4 - w : 12, 8);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [texture, slim, outer]);
  return (
    <div className="skin-flat-pair">
      <figure>
        <canvas
          ref={front}
          width={16}
          height={32}
          aria-label="皮肤正面二维预览"
        />
        <figcaption>正面</figcaption>
      </figure>
      <figure>
        <canvas
          ref={back}
          width={16}
          height={32}
          aria-label="皮肤背面二维预览"
        />
        <figcaption>背面</figcaption>
      </figure>
    </div>
  );
}
