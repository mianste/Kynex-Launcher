import { useState, useEffect } from "react";
import type { Instance } from "../../lib/types";
import minecraft from "../../assets/loaders/minecraft.png";
import fabric from "../../assets/loaders/fabric.png";
import quilt from "../../assets/loaders/quilt.svg";
import forge from "../../assets/loaders/forge.png";
import neoforge from "../../assets/loaders/neoforge.png";
import optifine from "../../assets/loaders/optifine.png";

export const loaderLabels: Record<string, string> = {
  vanilla: "原版",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
  optifine: "OptiFine",
};
const icons: Record<string, string> = {
  vanilla: minecraft,
  fabric,
  quilt,
  forge,
  neoforge,
  optifine,
};
export function LoaderIcon({ loader }: { loader: string }) {
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

export function InstanceIcon({
  instance,
  className = "",
}: {
  instance: Pick<
    Instance,
    "name" | "loader" | "icon" | "packIcon" | "packLogo"
  >;
  className?: string;
}) {
  const sources = [
    instance.icon,
    instance.packIcon,
    instance.packLogo,
    icons[instance.loader.toLowerCase()] || minecraft,
  ].filter(Boolean) as string[];
  const [failed, F] = useState(0);
  useEffect(
    () => F(0),
    [instance.icon, instance.packIcon, instance.packLogo, instance.loader],
  );
  return (
    <img
      className={`instance-version-icon ${className}`}
      onError={() => F((n) => Math.min(n + 1, sources.length - 1))}
      src={sources[Math.min(failed, sources.length - 1)]}
      alt={`${instance.name} 图标`}
      draggable={false}
    />
  );
}
