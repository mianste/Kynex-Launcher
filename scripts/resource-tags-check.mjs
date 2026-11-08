/**
 * 资源分类筛选的界面检查：模组用缩进层级，资源包/光影用分组标题。
 * 只验证前端结构与交互；真实检索结果需要桌面版后端。
 *
 * 运行：node scripts/resource-tags-check.mjs
 * 可选：KXL_BROWSER_PATH 指定 Chrome/Edge，KXL_REPORT_DIR 指定截图目录。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const reportDir = process.env.KXL_REPORT_DIR ?? "ui-report";
mkdirSync(reportDir, { recursive: true });
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "ignore" },
);
const browser = await chromium.launch({
  executablePath: process.env.KXL_BROWSER_PATH,
  headless: true,
});
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1420")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("http://127.0.0.1:1420/?nosplash");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await page.getByRole("button", { name: "模组", exact: true }).click();

  const filters = page.locator(".resource-filters .choice-trigger");
  if ((await filters.count()) < 3) throw new Error("模组页缺少筛选器");
  await filters.nth(2).click();
  const popover = page.locator(".choice-popover");
  await popover.waitFor();
  await page.waitForTimeout(260); // 等 choice-in 的 150ms 淡入结束再截图
  const options = popover.locator(".choice-option");
  const indents = popover.locator(".choice-option.indent");
  const optionCount = await options.count();
  const indentCount = await indents.count();
  if (optionCount < 25) throw new Error(`模组分类过少：${optionCount}`);
  if (indentCount < 4) throw new Error(`模组分类缺少层级缩进：${indentCount}`);
  await popover.getByText("科技", { exact: true }).click();
  if (!(await filters.nth(2).innerText()).includes("科技"))
    throw new Error("选择分类后未回填");
  await page.screenshot({ path: `${reportDir}/resource-tags-mod.png` });

  await page.getByRole("button", { name: "资源包", exact: true }).click();
  await page.locator(".resource-filters .choice-trigger").last().click();
  await popover.waitFor();
  await page.waitForTimeout(260);
  const groups = popover.locator(".choice-group");
  const groupCount = await groups.count();
  if (groupCount < 3) throw new Error(`资源包分组不足：${groupCount}`);
  const groupNames = await groups.allInnerTexts();
  if (!groupNames.includes("风格") || !groupNames.includes("分辨率"))
    throw new Error(`资源包分组不正确：${groupNames.join(",")}`);
  await page.screenshot({ path: `${reportDir}/resource-tags-pack.png` });

  if (errors.length) throw new Error(`页面报错：${errors.join("; ")}`);
  console.log(
    `RESOURCE_TAGS_OK 模组分类=${optionCount} 缩进=${indentCount} 资源包分组=${groupCount}`,
  );
} finally {
  await browser.close();
  server.kill();
}
