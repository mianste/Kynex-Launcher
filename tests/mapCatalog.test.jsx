import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MapCatalog } from "../src/features/download/MapCatalog";
import {
  MAP_COPYRIGHT_BODY,
  mapActionLabel,
  mapFromPixelmap,
  mapStatusLabel,
  normalizeMapPage,
} from "../src/features/download/mapSources";
vi.mock("../src/lib/bridge", () => ({
  desktop: false,
  api: vi.fn(),
  external: vi.fn(),
  pickFile: vi.fn(),
}));
vi.mock("../src/store", () => ({
  guarded: (fn) => fn(),
  useStore: Object.assign(
    () => ({ settings: { curseforgeKey: "" }, directoryId: "" }),
    {
      getState: () => ({ settings: { curseforgeKey: "" }, directoryId: "" }),
    },
  ),
}));
describe("地图目录", () => {
  it("列出全部地图，并按接口标志区分可下载和不能直接下载", () => {
    const hosted = mapFromPixelmap({
      title: "曲香坊",
      summary: "一座院子",
      author: "诗与2233",
      slug: "yzt2233_architecture-quxiangfang",
      preview_image: "https://oss.pixelmap.cc/pixelmap/covers/example.webp",
      url: "https://goto.pixelmap.cc/maps/yzt2233_architecture-quxiangfang",
      download_allowed: true,
      download_integrated: true,
      download_url: "https://oss.pixelmap.cc/pixelmap/file/example.zip",
    });
    expect(hosted?.action).toBe("file");
    expect(hosted?.author).toBe("诗与2233");
    expect(hosted?.previewUrl).toContain("oss.pixelmap.cc");
    expect(JSON.stringify(hosted)).not.toContain("download_url");
    const external = mapFromPixelmap({
      title: "图册",
      author: " ",
      slug: "XZhongjie_brochure-terra",
      preview_image: "",
      url: "https://brochure.terratea.cc/",
      download_allowed: true,
      download_integrated: false,
    });
    expect(external?.action).toBe("check");
    expect(external?.author).toBeUndefined();
    expect(external?.previewUrl).toBeUndefined();
    expect(mapActionLabel(external, true)).toBe("下载");
    const closed = mapFromPixelmap({
      title: "未开放",
      slug: "YSHOfficial_example",
      download_allowed: false,
      download_integrated: false,
    });
    expect(closed?.action).toBe("closed");
    expect(mapActionLabel(closed, true)).toContain("未开放下载");
    expect(mapActionLabel(hosted, false)).toBe("桌面版才能下载");
    expect(mapActionLabel(hosted, true)).toBe("下载并安装");
  });
  it("缺失字段不会被补成假数据，站点入口也不是可下载地图", () => {
    expect(mapFromPixelmap({ summary: "没有标题" })).toBeUndefined();
    const page = normalizeMapPage(
      {
        hits: [
          {
            id: "1",
            title: "没有图",
            source: "curseforge",
            sourceLabel: "CurseForge",
            action: "download",
          },
        ],
        total: 1,
        page: 0,
        pageSize: 30,
      },
      0,
    );
    expect(page.hits[0]?.previewUrl).toBeUndefined();
    expect(page.hits[0]?.author).toBeUndefined();
    expect(mapStatusLabel("installed")).toBe("已安装到存档");
    expect(mapStatusLabel("downloaded")).toBe("已下载，尚未安装到存档");
    expect(mapStatusLabel("opened")).toBe("没有完成");
  });
  it("页面上有显著版权提示，网页预览不会显示安装成功", () => {
    const html = renderToStaticMarkup(
      <MapCatalog
        query=""
        instanceId=""
        versions={["1.21.1"]}
        refreshToken={0}
      />,
    );
    expect(html).toContain("地图版权归原作者");
    expect(html).toContain(MAP_COPYRIGHT_BODY);
    expect(html).not.toContain("前往原站");
    expect(html).not.toContain("前往原页");
    expect(html).not.toContain("地图站点");
    expect(html).not.toContain("已安装到存档");
    expect(html).not.toContain("已下载，尚未安装到存档");
  });
});
