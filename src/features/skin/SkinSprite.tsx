import { loadSkinToCanvas } from "skinview-utils";
import { useEffect, useRef } from "react";
import type { SkinModel } from "./skinIO";
export function SkinSprite({
  texture,
  model,
  back = false,
  outer = true,
  label = "皮肤缩略图",
}: {
  texture: string;
  model: SkinModel;
  back?: boolean;
  outer?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.src = texture;
    image
      .decode()
      .then(() => {
        const canvas = ref.current;
        if (!live || !canvas) return;
        const source = document.createElement("canvas");
        loadSkinToCanvas(source, image);
        const s = source.width / 64;
        canvas.width = 16 * s;
        canvas.height = 32 * s;
        const g = canvas.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        const w = model === "Slim" ? 3 : 4;
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
            u * s,
            v * s,
            sw * s,
            sh * s,
            x * s,
            y * s,
            sw * s,
            sh * s,
          );
        draw(back ? 24 : 8, 8, 8, 8, 4, 0);
        draw(back ? 32 : 20, 20, 8, 12, 4, 8);
        draw(back ? 12 : 4, 20, 4, 12, back ? 8 : 4, 20);
        draw(back ? 28 : 20, 52, 4, 12, back ? 4 : 8, 20);
        draw(back ? 48 + w : 44, 20, w, 12, back ? 12 : 4 - w, 8);
        draw(back ? 40 + w : 36, 52, w, 12, back ? 4 - w : 12, 8);
        if (outer) {
          draw(back ? 56 : 40, 8, 8, 8, 4, 0);
          draw(back ? 32 : 20, 36, 8, 12, 4, 8);
          draw(back ? 12 : 4, 36, 4, 12, back ? 8 : 4, 20);
          draw(back ? 12 : 4, 52, 4, 12, back ? 4 : 8, 20);
          draw(back ? 48 + w : 44, 36, w, 12, back ? 12 : 4 - w, 8);
          draw(back ? 56 + w : 52, 52, w, 12, back ? 4 - w : 12, 8);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [texture, model, back, outer]);
  return (
    <canvas
      ref={ref}
      width={16}
      height={32}
      className="wardrobe-sprite"
      aria-label={label}
    />
  );
}
