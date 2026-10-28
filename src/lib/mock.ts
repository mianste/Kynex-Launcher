import type { GameVersion, Instance } from "./types";
import { defaultInstanceSettings } from "./types";
// 网页只展示明确标识的示例；桌面实例从磁盘扫描，初始为空。
export const previewInstances: Instance[] = [
  {
    id: "preview-fabric",
    name: "1.20.1-Fabric",
    version: "1.20.1",
    loader: "fabric",
    game: "java",
    path: "网页示例",
    settings: { ...defaultInstanceSettings },
  },
  {
    id: "preview-vanilla",
    name: "原版生存",
    version: "1.21.1",
    loader: "vanilla",
    game: "java",
    path: "网页示例",
    settings: { ...defaultInstanceSettings },
  },
];
export const previewVersions: GameVersion[] = [
  { id: "1.21.1", type: "release", releaseTime: "2024-08-08", url: "" },
  { id: "1.20.1", type: "release", releaseTime: "2023-06-12", url: "" },
  { id: "b1.7.3", type: "old_beta", releaseTime: "2011-07-08", url: "" },
];
