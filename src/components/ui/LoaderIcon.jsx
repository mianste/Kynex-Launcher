import { useState, useEffect } from "react";
import minecraft from "../../assets/loaders/minecraft.png";
import fabric from "../../assets/loaders/fabric.png";
import quilt from "../../assets/loaders/quilt.svg";
import forge from "../../assets/loaders/forge.png";
import neoforge from "../../assets/loaders/neoforge.png";
import optifine from "../../assets/loaders/optifine.png";
export const loaderLabels = {
  vanilla: "原版",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
  optifine: "OptiFine",
};
const icons = {
  vanilla: minecraft,
  fabric,
  quilt,
  forge,
  neoforge,
  optifine,
};
export function LoaderIcon({ loader }) {
  const key = loader.toLowerCase();
  return (
    <span
      className={`loader-icon loader-icon-${key}`}
      title={loaderLabels[key] ?? loader}
    >
      <img
        src={icons[key] || minecraft}
        alt={loaderLabels[key] ?? loader}
        draggable={false}
      />
    </span>
  );
}
export function InstanceIcon({ instance, className = "", cover = false }) {
  const key = instance.loader.toLowerCase();
  const fallback = icons[key] || minecraft;
  const sources = [
    instance.icon,
    instance.packIcon,
    instance.packLogo,
    fallback,
  ].filter(Boolean);
  const [failed, F] = useState(0);
  useEffect(
    () => F(0),
    [instance.icon, instance.packIcon, instance.packLogo, instance.loader],
  );
  const index = Math.min(failed, sources.length - 1);
  if (cover && index === sources.length - 1) {
    return (
      <span
        className={`instance-cover-art cover-${key}`}
        role="img"
        aria-label={`${instance.name} 图标`}
      >
        <img
          className="instance-cover-backdrop"
          src={fallback}
          alt=""
          draggable={false}
        />
        <img
          className="instance-cover-logo"
          src={fallback}
          alt=""
          draggable={false}
        />
      </span>
    );
  }
  const coverClass = cover ? "instance-custom-icon" : "";
  return (
    <img
      className={`instance-version-icon ${className} ${coverClass}`}
      onError={() => F((n) => Math.min(n + 1, sources.length - 1))}
      src={sources[index]}
      alt={`${instance.name} 图标`}
      draggable={false}
    />
  );
}
