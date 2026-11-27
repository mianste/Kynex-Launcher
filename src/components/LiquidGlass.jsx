import { useEffect, useState } from "react";

// A small, static displacement map: transparent centre, refraction only at the rim.
// Generated once after startup; no shader loop, copied background or per-frame sampling.
function edgeMap() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(256, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 256; x++) {
      const dx = x + 0.5 - 128,
        dy = y + 0.5 - 16;
      const qx = Math.abs(dx) - 112,
        qy = Math.abs(dy);
      const ox = Math.max(qx, 0),
        oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = 16 - length - Math.min(Math.max(qx, qy), 0);
      const bend = distance >= 0 ? (1 - Math.min(distance / 4, 1)) ** 2.4 : 0;
      const nx = length ? (ox / length) * Math.sign(dx) : 0;
      const ny = length ? (oy / length) * Math.sign(dy) : Math.sign(dy);
      const offset = (y * 256 + x) * 4;
      pixels.data.set(
        [128 + nx * bend * 90, 128 + ny * bend * 90, 128, 255],
        offset,
      );
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

export function LiquidGlass({ ready }) {
  const [map, setMap] = useState("");
  useEffect(() => {
    if (!ready || map) return;
    const timer = setTimeout(() => setMap(edgeMap()), 1200);
    return () => clearTimeout(timer);
  }, [ready, map]);
  return (
    <svg width="0" height="0" aria-hidden="true" className="liquid-glass-defs">
      <defs>
        <filter
          id="kynex-selection-fusion"
          x="-5%"
          y="-30%"
          width="110%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="soft" />
          <feColorMatrix
            in="soft"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
          />
        </filter>
        <filter
          id="kynex-nav-refraction"
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          {map && (
            <feImage
              href={map}
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="rim"
            />
          )}
          <feDisplacementMap
            in="SourceGraphic"
            in2="rim"
            scale={map ? 16 : 0}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
