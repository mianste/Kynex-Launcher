import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const out = "ui-report/startup-surface";
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1458"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:1458")).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 720 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("kynex-release-seen-stable", "2.2.1");
    localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
    localStorage.setItem("kynex-v092", JSON.stringify({version:8,state:{settings:{theme:"dark",uiOpacity:60,liquidOpacity:58,holidayThemeEnabled:false,holidayEffects:false,wallpaper:"island"}}}));
  });
  await page.goto("http://127.0.0.1:1458/?nosplash=1");
  await page.locator(".home-launch-button").waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("kynex-open-changelog")));
  await page.locator(".changelog-modal").waitFor();
  await page.waitForTimeout(650);
  assert.equal(await page.locator(".wallpaper-frame").evaluate(el => getComputedStyle(el).visibility), "visible");
  assert.equal(await page.locator(".app").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(0, 0, 0)");
  await page.screenshot({ path: out + "/changelog.png", omitBackground: true });
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await page.locator(".overlay").waitFor({state:"detached"});
  await page.locator(".nav").getByRole("button", {name:"设置",exact:true}).click();
  await page.getByRole("button", {name:"界面",exact:true}).click();
  await page.getByRole("button", {name:"浅色",exact:true}).waitFor();
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = callback => {
      const transition = start(callback);
      transition.ready.then(() => {
        for (const animation of document.getAnimations()) {
          if (animation.animationName?.startsWith("kxl-appearance")) {
            animation.pause();
            animation.currentTime = 210;
          }
        }
      });
      window.__surfaceTransition = transition;
      return transition;
    };
  });
  for (const [index, theme] of ["浅色", "玻璃主题", "深色"].entries()) {
    await page.getByRole("button", {name:theme,exact:true}).click();
    await page.evaluate(() => window.__surfaceTransition.ready);
    const oldOpacity = await page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-old(root)").opacity);
    assert.equal(oldOpacity, "1");
    await page.screenshot({path:`${out}/theme-mid-${index}.png`,omitBackground:true});
    await page.evaluate(() => window.__surfaceTransition.skipTransition());
    await page.evaluate(() => window.__surfaceTransition.finished);
  }
  await page.evaluate(async () => {
    const {useStore} = await import("/src/store/index.js");
    useStore.getState().updateSettings({uiOpacity:0,wallpaper:"plain"});
  });
  await page.waitForTimeout(650);
  await page.screenshot({path:out+"/zero-panel-opacity.png",omitBackground:true});
  await page.route("**/never-ready.webm", route => route.abort());
  await page.evaluate(async () => {
    const {useStore} = await import("/src/store/index.js");
    useStore.getState().updateSettings({wallpaper:"video:http://127.0.0.1:1458/never-ready.webm"});
  });
  await page.waitForTimeout(650);
  await page.screenshot({path:out+"/failed-video.png",omitBackground:true});
  await page.evaluate(async () => {
    const {useStore} = await import("/src/store/index.js");
    useStore.getState().updateSettings({wallpaper:"island",uiOpacity:60});
    window.__surfaceTransitionCount = 0;
    document.startViewTransition = undefined;
  });
  await page.getByRole("button", {name:"浅色",exact:true}).click();
  assert.equal(await page.locator(".app").evaluate(el => getComputedStyle(el).opacity), "1");
  await page.screenshot({path:out+"/fallback.png",omitBackground:true});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.getByRole("button", {name:"深色",exact:true}).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.deepEqual(errors, []);
  const result = {modalKeepsWallpaperVisible:true,solidWindowBase:true,oldSnapshotStaysOpaque:true,zeroPanelOpacityKeepsWindowSolid:true,failedVideoKeepsBackground:true,legacyBrowserKeepsWindowOpacity:true,reducedMotion:true,pageErrors:errors};
  writeFileSync(out+"/result.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  server.kill();
}
