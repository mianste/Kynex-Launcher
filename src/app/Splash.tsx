import { useEffect, useState, useId } from "react";
import icon from "../assets/kxl-icon.png";
export function KxlMark({ animated = false }: { animated?: boolean }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      className={`kxl-mark ${animated ? "animated" : ""}`}
      viewBox="0 0 1254 1254"
      aria-label="KXL 棱晶 K 图标"
      role="img"
    >
      <defs>
        <clipPath id={`${uid}-stem`}>
          <path d="M184 221 251 172 468 303 468 520 475 734 475 1004 251 1128 184 1034Z" />
        </clipPath>
        <clipPath id={`${uid}-upper`}>
          <path d="M475 518 803 224 1096 167 1096 326 770 641 634 600 475 734Z" />
        </clipPath>
        <clipPath id={`${uid}-lower`}>
          <path d="M475 734 634 600 770 641 1096 966 1096 1154 800 1078Z" />
        </clipPath>
        <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-green)" stopOpacity="0" />
          <stop offset=".5" stopColor="var(--white)" stopOpacity=".65" />
          <stop offset="1" stopColor="var(--brand-blue)" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${uid}-k`}>
          <path d="M184 221 251 172 468 303 468 520 475 518 803 224 1096 167 1096 326 770 641 1096 966 1096 1154 800 1078 475 734 475 1004 251 1128 184 1034Z" />
        </clipPath>
      </defs>
      <image className="prism-base" href={icon} width="1254" height="1254" />
      <g className="prism-facets">
        {["stem", "upper", "lower"].map((part, n) => (
          <image
            key={part}
            className={`prism-facet facet-${n}`}
            href={icon}
            width="1254"
            height="1254"
            clipPath={`url(#${uid}-${part})`}
          />
        ))}
      </g>
      <g
        className="prism-outline"
        fill="none"
        stroke="var(--brand-green)"
        strokeWidth="3"
      >
        <path
          className="prism-edge edge-stem"
          pathLength="100"
          d="M251 172 468 303V520L251 705V1128L475 1004V734M251 172V705"
        />
        <path
          className="prism-edge edge-upper"
          pathLength="100"
          d="M475 518 803 224 1096 167 634 600 475 518V734L634 600"
        />
        <path
          className="prism-edge edge-lower"
          pathLength="100"
          d="M634 600 770 641 1096 966 1096 1154 800 1078 475 734M770 641 1096 966"
        />
      </g>
      <g clipPath={`url(#${uid}-k)`}>
        <rect
          className="prism-sweep"
          x="-900"
          y="0"
          width="450"
          height="1600"
          fill={`url(#${uid}-shine)`}
          transform="rotate(-22 627 627)"
        />
      </g>
    </svg>
  );
}
export function Splash({
  ready,
  finish,
}: {
  ready: boolean;
  finish: () => void;
}) {
  const [elapsed, E] = useState(false);
  const [exit, X] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => E(true), 2100);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (
      ready &&
      elapsed &&
      !new URLSearchParams(location.search).has("holdSplash")
    ) {
      X(true);
      const t = setTimeout(finish, 220);
      return () => clearTimeout(t);
    }
  }, [ready, elapsed, finish]);
  return (
    <div
      className={`splash ${exit ? "exit" : ""}`}
      role="status"
      aria-label="KXL 启动动画"
    >
      <div className="splash-center">
        <KxlMark animated />
      </div>
    </div>
  );
}
