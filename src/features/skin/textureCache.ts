import { api } from "../../lib/bridge";
import { decodeCape, capeFileFromData } from "./cape";
const textures = new Map<string, Promise<string>>();
const images = new Map<string,string>();
const capes = new Map<string,HTMLCanvasElement>();
const pendingCapes = new Map<string,Promise<HTMLCanvasElement>>();
export function cachedTexture(url?:string) { return url ? images.get(url) : undefined; }
export function loadTexture(url:string,cape=false):Promise<string> {
 if(!url.startsWith("https://"))return Promise.resolve(url);
 let job=textures.get(url);
 if(!job){job=api<string>("skin_texture",{url,cape}).then(data=>{images.set(url,data);return data;}).catch(e=>{textures.delete(url);throw e;});textures.set(url,job);}
 return job;
}
export function cachedCape(url:string) {return capes.get(url);}
export function loadCape(url:string) {
 const ready=capes.get(url);if(ready)return Promise.resolve(ready);
 let job=pendingCapes.get(url);
 if(!job){job=loadTexture(url,true).then(data=>decodeCape(capeFileFromData(data))).then(canvas=>{if(capes.size>=64)capes.delete(capes.keys().next().value!);capes.set(url,canvas);pendingCapes.delete(url);return canvas;}).catch(e=>{pendingCapes.delete(url);throw e;});pendingCapes.set(url,job);}
 return job;
}
