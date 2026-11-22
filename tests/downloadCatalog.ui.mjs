import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.KXL_BROWSER_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 720 } });
  const origin = process.env.KXL_DEV_ORIGIN || "http://localhost:5173";
  const png = readFileSync("src/assets/kxl-icon.png").toString("base64");
  const landscape = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#739e78"/></svg>',
  );
  const build = JSON.parse(readFileSync("config/build-channel.json", "utf8"));
  await page.route("https://cdn.modrinth.com/**", (route) => route.abort());
  await page.route("https://images.weserv.nl/**", (route) => route.abort());
  await page.addInitScript(({ png, landscape, build }) => {
    localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
    localStorage.setItem("kynex-release-seen-" + build.channel, build.version);
    window.isTauri = true;
    window.catalogCalls = [];
    window.shaderCalls = [];
    let id = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++id,
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command !== "dispatch") return 1;
        const { action, payload } = args;
        if (action === "check_update") return { status: "current" };
        if (action === "list_instances") return [{
          id: "fixture", name: "测试实例", game: "java", version: "1.21.1",
          loader: "fabric", path: "C:/fixture",
          settings: { isolation: "all", memory: 2048, java: "", width: 854, height: 480 },
        }];
        if (action === "schematic_catalog_download") {
          window.schematicDownload = payload;
          await new Promise((resolve) => { window.finishSchematicDownload = resolve; });
          return { name: "work.litematic", directory: "C:/fixture/schematics", alreadyPresent: false };
        }
        if (action === "pixelmap_schematics") {
          window.catalogCalls.push(action);
          await new Promise((resolve) => { window.finishSchematicQuery = resolve; });
          return { hits: Array.from({ length: 21 }, (_, i) => ({
            id: "test_" + i,
            name: "投影作品 " + (i + 1),
            format: "litematic",
            icon: i === 0 ? landscape : undefined,
          })) };
        }
        if (action === "search" && payload.kind === "modpack" && payload.source === "modrinth") {
          const projects = ["COBBLEVERSE", "Sodium Plus"];
          return { hits: projects.map((title, index) => ({
            project_id: title, title, slug: title, project_type: "modpack", source: "modrinth",
            downloads: index + 1, icon_url: "https://cdn.modrinth.com/data/fixture/" + index + ".png",
          })), total: projects.length };
        }
        if (action === "search" && payload.kind === "shader") {
          window.shaderCalls.push(payload);
          if (payload.source === "curseforge" && payload.page === 0 && !payload.force) {
            await new Promise((resolve) => { window.finishSlowSource = resolve; });
          }
          const title = `${payload.source} shader ${payload.page + 1}`;
          return { hits: [{
            project_id: title, title, slug: title, project_type: "shader", source: payload.source,
            downloads: 10, icon_url: landscape,
          }], total: payload.source === "modrinth" ? 31 : 1, pageSize: 30 };
        }
        if (action === "search") return { hits: [], total: 0 };
        if (action === "icon") return { data: payload.cacheOnly ? "" : "data:image/png;base64," + png };
        if (action === "game_directories") return { items: [], activeId: "default" };
        return [];
      },
    };
  }, { png, landscape, build });
  await page.goto(origin + "/?nosplash=1#discover");
  await page.getByRole("button", { name: "整合包", exact: true }).click();
  for (const title of ["COBBLEVERSE", "Sodium Plus"]) {
    await page.getByRole("img", { name: title + " 图标" }).locator("img.loaded").waitFor();
  }

  const shaderTab = page.getByRole("button", { name: "光影", exact: true });
  const firstShader = page.getByRole("heading", { name: "modrinth shader 1" });
  const lateShader = page.getByRole("heading", { name: "curseforge shader 1" });
  await shaderTab.click();
  await page.waitForFunction(() => typeof window.finishSlowSource === "function");
  await firstShader.waitFor();
  assert.ok(await page.getByRole("img", { name: "modrinth shader 1 图标" }).locator("img.loaded").isVisible());
  await page.evaluate(() => window.finishSlowSource());
  await page.getByRole("tab", { name: "CurseForge" }).click();
  await lateShader.waitFor();
  await page.getByRole("tab", { name: "全部来源" }).click();
  assert.ok(await firstShader.isVisible());
  assert.equal(await lateShader.count(), 0);
  assert.equal(await page.evaluate(() => window.shaderCalls.filter((call) => call.page === 0).length), 2);

  await page.getByRole("button", { name: "下一页", exact: true }).click();
  const secondShader = page.getByRole("heading", { name: "modrinth shader 2" });
  await secondShader.waitFor();
  await page.getByRole("button", { name: "整合包", exact: true }).click();
  assert.ok(await page.getByRole("heading", { name: "COBBLEVERSE", exact: true }).isVisible());
  await shaderTab.click();
  assert.ok(await secondShader.isVisible());
  assert.equal(await page.getByRole("status", { name: "正在加载资源" }).count(), 0);
  assert.ok(await page.getByText(/第 2 \/ 2 页/).isVisible());
  assert.equal(await page.evaluate(() => window.shaderCalls.filter((call) => call.page === 1).length), 2);

  await page.getByRole("button", { name: "上一页", exact: true }).click();
  assert.ok(await firstShader.isVisible());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  assert.ok(await firstShader.isVisible());
  await lateShader.waitFor();
  assert.equal(await page.evaluate(() => window.shaderCalls.filter((call) => call.force).length), 2);

  await page.getByRole("button", { name: "投影", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "投影版权警告" });
  await warning.getByRole("button", { name: "关闭", exact: true }).click();
  assert.equal(await page.getByText("免费下载 · 作品已标明作者和许可证", { exact: true }).count(), 0);
  assert.ok(await page.getByRole("button", { name: "导入并预览" }).isVisible());
  await page.getByRole("tab", { name: "像素茶艺" }).click();
  const loading = page.getByRole("status", { name: "正在加载投影" });
  await loading.waitFor();
  assert.equal(await loading.locator(".resource-skeleton-row").count(), 6);
  assert.equal(await loading.textContent(), "");
  await page.waitForFunction(() => typeof window.finishSchematicQuery === "function");
  await page.evaluate(() => window.finishSchematicQuery());
  await page.getByRole("heading", { name: "投影作品 1", exact: true }).waitFor();
  assert.equal(await loading.count(), 0);
  const cover = page.getByRole("img", { name: "投影作品 1 图标", exact: true }).locator("img.loaded");
  await cover.waitFor();
  assert.deepEqual(await cover.evaluate((image) => ({
    size: [image.naturalWidth, image.naturalHeight],
    fit: getComputedStyle(image).objectFit,
    frame: getComputedStyle(image.parentElement).borderTopWidth,
    background: getComputedStyle(image.parentElement).backgroundColor,
  })), { size: [160, 90], fit: "cover", frame: "0px", background: "rgba(0, 0, 0, 0)" });
  const firstWork = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "投影作品 1", exact: true }),
  });
  await firstWork.getByRole("button", { name: "下载", exact: true }).click();
  await firstWork.getByRole("button", { name: "正在下载…" }).waitFor();
  await page.waitForFunction(() => typeof window.finishSchematicDownload === "function");
  const download = await page.evaluate(() => {
    window.finishSchematicDownload();
    return window.schematicDownload;
  });
  assert.equal(download.id, "fixture");
  assert.equal(download.entry, "test_0");
  assert.equal(download.source, "pixelmap");
  await firstWork.getByRole("button", { name: "下载", exact: true }).waitFor();
  assert.equal(await page.getByText("投影已下载", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "打开投影文件夹" }).count(), 0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByRole("heading", { name: "投影作品 21", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "投影作品 1", exact: true }).count(), 0);
  assert.ok(await page.getByRole("button", { name: "下一页", exact: true }).isDisabled());
  await shaderTab.click();
  await page.getByRole("button", { name: "投影", exact: true }).click();
  assert.ok(await warning.isVisible());
  await warning.getByRole("button", { name: "关闭", exact: true }).click();
  assert.ok(await page.getByRole("heading", { name: "投影作品 21", exact: true }).isVisible());
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.getByRole("heading", { name: "投影作品 1", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.catalogCalls), ["pixelmap_schematics"]);
} finally {
  await browser.close();
}
