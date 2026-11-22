import { api } from "../../lib/bridge";
import { decodeCape, capeFileFromData } from "./cape";
const textures = new Map();
const images = new Map();
const capes = new Map();
const pendingCapes = new Map();
export function cachedTexture(url) {
  return url ? images.get(url) : undefined;
}
export function loadTexture(url, cape = false) {
  if (!url.startsWith("https://")) return Promise.resolve(url);
  let job = textures.get(url);
  if (!job) {
    job = api("skin_texture", { url, cape })
      .then((data) => {
        images.set(url, data);
        return data;
      })
      .catch((e) => {
        textures.delete(url);
        throw e;
      });
    textures.set(url, job);
  }
  return job;
}
export function cachedCape(url) {
  return capes.get(url);
}
export function loadCape(url) {
  const ready = capes.get(url);
  if (ready) return Promise.resolve(ready);
  let job = pendingCapes.get(url);
  if (!job) {
    job = loadTexture(url, true)
      .then((data) => decodeCape(capeFileFromData(data)))
      .then((canvas) => {
        if (capes.size >= 64) capes.delete(capes.keys().next().value);
        capes.set(url, canvas);
        pendingCapes.delete(url);
        return canvas;
      })
      .catch((e) => {
        pendingCapes.delete(url);
        throw e;
      });
    pendingCapes.set(url, job);
  }
  return job;
}
