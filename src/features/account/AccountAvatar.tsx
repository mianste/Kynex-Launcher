import { UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadSkinToCanvas } from "skinview-utils";
import alex from "../../assets/skins/alex.png?inline";
import { desktop } from "../../lib/bridge";
import type { Account } from "../../lib/types";
import { useStore } from "../../store";
import { syncAppearance } from "../skin/appearanceSync";
import { cachedTexture, loadTexture } from "../skin/textureCache";
import { defaultSkin } from "../skin/textures";

function offlineTexture(uuid: string) {
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) return defaultSkin();

  // The legacy Java default uses the low bit of the UUID hash.
  const words = compact.match(/.{8}/g) ?? [];
  const hash = words.reduce((value, word) => value ^ parseInt(word, 16), 0);
  return (hash & 1) === 1 ? alex : defaultSkin();
}

export function AccountAvatar({ account }: { account?: Account }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paintedTexture, setPaintedTexture] = useState<string>();
  const texture = account?.kind === "offline"
    ? offlineTexture(account.uuid)
    : account?.skin;
  const missingProfileId = account && account.kind !== "offline"
    && !account.skin && !account.uploadableTextures ? account.id : undefined;

  useEffect(() => {
    if (!desktop || !missingProfileId) return;
    const original = useStore.getState().accounts.find(({ id }) => id === missingProfileId);
    let live = true;
    void syncAppearance(missingProfileId).then((updated) => {
      if (!live) return;
      useStore.setState(({ accounts }) => ({
        accounts: accounts.map((current) => current === original ? updated : current),
      }));
    }).catch(() => {});
    return () => { live = false; };
  }, [missingProfileId]);

  useEffect(() => {
    if (!texture) return;
    const remote = texture.startsWith("https://");
    if (remote ? !desktop : !texture.startsWith("data:image/png;")) return;

    let live = true;
    async function paint(source: string) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const target = canvas.current;
      if (!live || !target) return;

      const skin = document.createElement("canvas");
      loadSkinToCanvas(skin, image);
      const size = skin.width / 8;
      target.width = size;
      target.height = size;
      const context = target.getContext("2d");
      if (!context) return;
      context.drawImage(skin, size, size, size, size, 0, 0, size, size);
      context.drawImage(skin, 5 * size, size, size, size, 0, 0, size, size);
      setPaintedTexture(texture);
    }
    const cached = cachedTexture(texture);
    void (cached ? Promise.resolve(cached) : loadTexture(texture))
      .then(paint)
      .catch(() => {});
    return () => { live = false; };
  }, [texture]);

  const visible = !!texture && paintedTexture === texture;
  return (
    <span className="player-avatar" aria-hidden="true">
      <canvas ref={canvas} width={8} height={8} hidden={!visible} />
      {!visible && <UserRound size={19} />}
    </span>
  );
}
