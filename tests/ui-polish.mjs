import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:1466";
const output = "ui-report/ui-polish";
mkdirSync(output, { recursive: true });
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1466"],
  { stdio: "ignore", windowsHide: true },
);
let browser;
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.KXL_BROWSER_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1080, height: 720 },
  });
  const fixtureSource = readFileSync("scripts/assistant-ui-check.mjs", "utf8");
  const fixture = fixtureSource
    .slice(
      fixtureSource.indexOf("await page.addInitScript(() => {"),
      fixtureSource.indexOf("  await page.goto("),
    )
    .replace(
      "window.calls.push({ action, payload: p });",
      `window.calls.push({ action, payload: p });
      if (action === "check_update") return {status:"current"};
      if (action === "ai_voice_config") return {endpoint:"",model:"",configured:false};
      if (action === "agent_tool") return [];
      if (action === "agent_list") return [];
      if (action === "assistant_context") return {attachments:[{kind:"latest",name:"latest.log",text:"测试日志",truncated:true}],mods:{count:0,files:[]}};`,
    );
  await new Function("page", `return (async () => {${fixture}})()`)(page);
  await page.addInitScript(
    ({ channel, version }) => {
      localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
      localStorage.setItem("kynex-release-seen-" + channel, version);
    if (!localStorage.getItem("kynex-v092")) {
      localStorage.setItem("kynex-v092", JSON.stringify({
        version: 6,
        state: { settings: { theme: "light", uiOpacity: 100 }, directorySelections: { qa: "test" } },
      }));
    }
    },
    JSON.parse(readFileSync("config/build-channel.json", "utf8")),
  );
  await page.goto(origin + "/?nosplash=1");
  await page
    .getByRole("button", { name: "打开 AI 助手", exact: true })
    .waitFor();
  const goto = (route) =>
    page.evaluate(async (route) => {
      const { useStore } = await import("/src/store/index.js");
      useStore.getState().setPage(route);
    }, route);
  assert.equal(await page.evaluate(async () => {
    const { useStore } = await import("/src/store/index.js");
    return useStore.getState().directorySelections.qa;
  }), "test");
  const appearance = (theme, uiOpacity) =>
    page.evaluate(
      async (settings) => {
        const { useStore } = await import("/src/store/index.js");
        useStore.getState().updateSettings(settings);
      },
      { theme, uiOpacity },
    );
  const menu = page.getByRole("listbox");
  let menuCount = 0;
  async function check(trigger, opacity) {
    await trigger.click();
    await menu.waitFor();
    assert.ok(await menu.getByRole("option").count());
    const box = await menu.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 1080 &&
        box.y + box.height <= 720,
      JSON.stringify(box),
    );
    const style = await menu.evaluate((node) => {
      const style = getComputedStyle(node);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return {
        alpha: ctx.getImageData(0, 0, 1, 1).data[3],
        opacity: style.opacity,
        filter: style.backdropFilter,
        transform: style.transform,
      };
    });
    assert.ok(
      Math.abs(style.alpha - (opacity / 100) * 255) <= 1,
      JSON.stringify(style),
    );
    assert.equal(style.opacity, "1");
    assert.equal(style.filter, "none");
    assert.equal(style.transform, "none");
    if (opacity < 100) {
      assert.ok(await page.locator(".app > [style*='mask-image']").count());
    }
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await page.locator(".app > [style*='mask-image']").count(), 0);
    menuCount++;
  }
  async function checkPage() {
    const triggers = page.getByRole("combobox");
    for (let index = 0; index < (await triggers.count()); index++) {
      const trigger = triggers.nth(index);
      if ((await trigger.isVisible()) && (await trigger.isEnabled()))
        await check(trigger, 100);
    }
  }
  await appearance("light", 100);
  for (const route of [
    "home",
    "library",
    "instance",
    "skin",
    "account",
    "discover",
    "settings",
  ]) {
    await goto(route);
    await page.waitForTimeout(220);
    if (route === "discover") {
      for (const kind of [
        "游戏本体",
        "整合包",
        "模组",
        "资源包",
        "光影",
        "数据包",
        "地图",
      ]) {
        await page.getByRole("button", { name: kind, exact: true }).click();
        await checkPage();
      }
    } else if (route === "settings") {
      for (const category of [
        "启动",
        "Java 管理",
        "下载",
        "界面",
        "更新",
        "高级",
        "关于",
      ]) {
        await page
          .locator(".settings-nav")
          .getByRole("button", { name: category, exact: true })
          .click();
        await checkPage();
      }
    } else await checkPage();
  }
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "高级", exact: true })
    .click();
  const models = page.getByRole("combobox", { name: "模型配置" });
  await models.waitFor();
  assert.equal(
    await page.getByText(/默认提供 DeepSeek|选填。配置后显示/).count(),
    0,
  );
  for (const theme of ["light", "dark"])
    for (const alpha of [0, 50, 100]) {
      await appearance(theme, alpha);
      await check(models, alpha);
    }
  await models.press("Enter");
  await models.press("End");
  await models.press("Enter");
  assert.equal(
    await page.getByLabel("服务名称", { exact: true }).inputValue(),
    "",
  );
  await models.click();
  await menu.getByRole("option", { name: /DeepSeek/ }).click();
  assert.equal(
    await page.getByLabel("服务名称", { exact: true }).inputValue(),
    "DeepSeek",
  );
  await models.press("Enter");
  await page.keyboard.press("Tab");
  await menu.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "服务名称",
  );
  await goto("home");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("kynex-open-guide", { detail: { page: "home" } }),
    ),
  );
  const guide = page.getByRole("dialog", { name: "启动器使用引导" });
  await check(page.getByRole("combobox", { name: "选择引导页面" }), 100);
  assert.ok(await guide.isVisible());
  await guide.getByRole("button", { name: "跳过引导" }).click();
  await appearance("dark", 50);
  await goto("library");
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  const assistant = page.locator(".assistant-panel");
  await assistant
    .getByRole("button", { name: "最近一次游戏日志（只取了部分内容）" })
    .waitFor();
  assert.equal(
    await assistant
      .locator(".assistant-header")
      .evaluate((node) => getComputedStyle(node).borderBottomWidth),
    "0px",
  );
  assert.equal(
    await page.locator(".nav").getAttribute("data-assistant-obscured"),
    "true",
  );
  await page.screenshot({ path: output + "/assistant-dark-transparent.png" });
  await assistant
    .getByRole("button", { name: "整合包工坊", exact: true })
    .click();
  const workshop = page.getByRole("region", { name: "AI 整合包工坊" });
  assert.equal(
    await workshop.getByLabel("想制作什么整合包？").evaluate((node) => getComputedStyle(node).resize),
    "none",
  );
  assert.equal(await workshop.locator("summary").count(), 0);
  await assistant.waitFor({ state: "hidden" });
  await goto("skin");
  const tile = page.locator(".wardrobe-card").first();
  await tile.scrollIntoViewIfNeeded();
  for (const item of [tile, page.locator(".wardrobe-add")]) {
    const box = await item.boundingBox();
    assert.ok(Math.abs(box.width - box.height) < 2, JSON.stringify(box));
  }
  await page.screenshot({ path: output + "/skin-tiles.png" });
  await goto("settings");
  await page.locator(".settings-nav").getByRole("button", { name: "界面", exact: true }).click();
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  const baseColor = page.locator(".color-palette").filter({ has: page.locator('summary[aria-label="调主题底色"]') });
  const accentColor = page.locator(".color-palette").filter({ has: page.locator('summary[aria-label="调强调色"]') });
  await baseColor.locator("summary").click();
  await baseColor.getByLabel("主题底色色号").fill("#203557");
  await baseColor.getByRole("button", { name: "应用颜色" }).click();
  await accentColor.locator("summary").click();
  await accentColor.getByLabel("强调色色号").fill("#ff9933");
  await accentColor.getByRole("button", { name: "应用颜色" }).click();
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  const palettePixel = await baseColor.evaluate((node) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = getComputedStyle(node).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  });
  assert.ok(palettePixel.every((channel, index) => Math.abs(channel - [32, 53, 87, 128][index]) <= 1), JSON.stringify(palettePixel));
  await page.screenshot({ path: output + "/custom-theme-palette.png" });
  await page.locator(".settings-nav").getByRole("button", { name: "高级", exact: true }).click();
  await check(models, 50);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-custom-theme"));
  const colors = await page.locator("html").evaluate((root) => ({
    surface: getComputedStyle(root).getPropertyValue("--surface").trim(),
    accent: getComputedStyle(root).getPropertyValue("--accent").trim(),
    text: getComputedStyle(root).getPropertyValue("--text").trim(),
  }));
  assert.deepEqual(colors, { surface: "#203557", accent: "#ff9933", text: "#ffffff" });
  assert.ok(menuCount > 15);
  assert.equal(await page.locator("select").count(), 0);
  console.log(
    `PASS: 检查了 ${menuCount} 次下拉菜单，覆盖主题、透明度、防重叠、键盘操作、自定义底色与强调色保存。`,
  );
} finally {
  await browser?.close();
  server.kill();
}
