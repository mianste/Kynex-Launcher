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
      {key === "vanilla" ? (
        <svg viewBox="0 0 64 64" role="img" aria-label="原版">
          <path fill="#649d3e" d="M4 17 32 2l28 15-28 16z" />
          <path fill="#6b4931" d="m4 17 28 16v29L4 46z" />
          <path fill="#91643c" d="M32 33 60 17v29L32 62z" />
          <path
            fill="#7db94a"
            d="m4 17 28 16v10l-7-4v-5l-7-4v6l-7-4v-7l-7-2z"
          />
          <path
            fill="#508b35"
            d="m32 33 28-16v12l-7 4v-5l-7 4v8l-7 4v-6l-7 4z"
          />
          <path
            fill="#95c657"
            d="m11 17 7-4 7 4-7 4zm21-11 7 4-7 4-7-4zm7 15 7-4 7 4-7 4z"
          />
        </svg>
      ) : (
        <img
          src={icons[key]}
          alt={loaderLabels[key] ?? loader}
          draggable={false}
        />
      )}
    </span>
  );
}
