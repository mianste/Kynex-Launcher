import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const output = "ui-report/launcher-details";
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:1477";
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1477"],
  { windowsHide: true, stdio: "ignore" },
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
  const context = await browser.newContext({
    viewport: { width: 1080, height: 720 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const old = readFileSync("tests/fixtures/assistant-desktop.js", "utf8");
  let fixture = old.slice(
    old.indexOf("await page.addInitScript(() => {"),
    old.indexOf("  // END_DESKTOP_FIXTURE"),
  );
  fixture = fixture.replace(
    "let models = {",
    `window.fixtureInstances=[instance,{...instance,id:'second',name:'第二个实例',loader:'forge'},{...instance,id:'third',name:'第三个实例',loader:'quilt'}];let models = {`,
  );
  fixture = fixture.replace(
    "window.calls.push({ action, payload: p });",
    `window.calls.push({ action, payload: p });
    if(action==='check_update')return {status:'current'};
    if(action==='list_instances')return window.fixtureInstances;
    if(action==='hydrate_pack_icons'||action==='agent_list')return [];
    if(action==='read_image')return {name:'selected.png',mime:'image/png',base64:window.testPng};
    if(action==='save_instance_icon'){const item=window.fixtureInstances.find(i=>i.id===p.id);item.icon='data:'+p.mime+';base64,'+p.base64;return {...item};}
  `,
  );
  await new Function("page", `return (async()=>{${fixture}})()`)(page);
  const build = JSON.parse(readFileSync("config/build-channel.json", "utf8"));
  await page.addInitScript(({ channel, version }) => {
    localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
    localStorage.setItem("kynex-release-seen-" + channel, version);
    if (!localStorage.getItem("kynex-v092"))
      localStorage.setItem(
        "kynex-v092",
        JSON.stringify({ version: 9, state: { selected: "second" } }),
      );
  }, build);
  await page.goto(origin + "/?nosplash=1");
  const state = () =>
    page.evaluate(
      async () =>
        (await import("/src/store/index.js")).useStore.getState().selected,
    );
  await page.waitForFunction(() =>
    document
      .querySelector(".home-launch-button")
      ?.textContent.includes("第二个实例"),
  );
  assert.equal(await state(), "second");
  await page.getByRole("button", { name: "更多启动选项", exact: true }).click();
  await page.getByRole("button", { name: /版本选择/ }).click();
  const versions = page.getByRole("dialog", { name: "选择版本", exact: true });
  await versions.getByRole("button", { name: /第三个实例/ }).click();
  await versions
    .getByRole("button", { name: "使用此版本", exact: true })
    .click();
  await page.reload();
  await page.waitForFunction(() =>
    document
      .querySelector(".home-launch-button")
      ?.textContent.includes("第三个实例"),
  );
  assert.equal(await state(), "third");
  await page.evaluate(async () =>
    (await import("/src/store/index.js")).useStore
      .getState()
      .setPage("library"),
  );
  await page.locator(".instance-card").nth(2).waitFor();
  await page.waitForFunction(
    () =>
      window.calls.filter(
        (c) => c.action === "resources" && c.payload?.kind === "saves",
      ).length >= 3,
  );
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.action === "resources" &&
        c.payload?.id === "third" &&
        c.payload?.kind === "datapacks",
    ),
  );
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const g = canvas.getContext("2d");
    g.fillStyle = "#2f6253";
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#f5eac8";
    g.font = "bold 56px sans-serif";
    g.fillText("KYNEX", 56, 170);
    window.testPng = canvas.toDataURL("image/png").split(",")[1];
    const { useStore } = await import("/src/store/index.js");
    window.beforeIcons = useStore.getState().instances.slice();
    window.calls = [];
  });
  const unchanged = page
    .locator(".instance-card")
    .filter({
      has: page.locator(".instance-title", { hasText: "Fabric 测试实例" }),
    })
    .locator(".instance-cover img");
  const previousSrc = await unchanged.getAttribute("src");
  await page
    .getByRole("button", { name: "更换 第二个实例 图标", exact: true })
    .click();
  await page.waitForFunction(async () =>
    (await import("/src/store/index.js")).useStore
      .getState()
      .instances[1].icon?.startsWith("data:image/png"),
  );
  assert.equal(await unchanged.getAttribute("src"), previousSrc);
  const mutations = await page.evaluate(async () => {
    const { useStore } = await import("/src/store/index.js");
    return {
      sameOthers:
        window.beforeIcons[0] === useStore.getState().instances[0] &&
        window.beforeIcons[2] === useStore.getState().instances[2],
      calls: window.calls.map((c) => ({
        action: c.action,
        id: c.payload?.id,
        kind: c.payload?.kind,
      })),
    };
  });
  assert.equal(mutations.sameOthers, true, "其他实例对象应保持不变");
  writeFileSync(
    output + "/icon-calls.json",
    JSON.stringify(mutations, null, 2),
  );
  assert.equal(
    mutations.calls.some((c) =>
      [
        "list_instances",
        "game_directories",
        "hydrate_pack_icons",
        "list_accounts",
      ].includes(c.action),
    ),
    false,
    "更换图标不应刷新整个列表",
  );
  assert.equal(
    mutations.calls.some(
      (c) =>
        c.action === "resources" && c.kind === "saves" && c.id !== "second",
    ),
    false,
    "更换图标不应重新扫描其他实例的存档",
  );
  for (const image of await page.locator(".instance-cover > img").all()) {
    const bounds = await image.evaluate((img) => ({
      image: img.getBoundingClientRect().toJSON(),
      parent: img.parentElement.getBoundingClientRect().toJSON(),
      fit: getComputedStyle(img).objectFit,
    }));
    assert.equal(bounds.fit, "cover");
    assert.ok(Math.abs(bounds.image.width - bounds.parent.width) < 2);
    assert.ok(Math.abs(bounds.image.height - bounds.parent.height) < 2);
  }
  assert.equal(
    await page.locator(".app").evaluate((app) => app.scrollTop),
    0,
    "窗口本身不能因控件聚焦而整体滚动",
  );
  await page.screenshot({
    path: output + "/library.png",
    omitBackground: true,
  });
  const cornerChecks = [];
  for (const scale of [1, 1.25, 1.5, 2]) {
    const sample = await browser.newPage({
      viewport: { width: 1080, height: 720 },
      deviceScaleFactor: scale,
    });
    await sample.goto(origin + "/?nosplash=1");
    await sample.setContent(
      '<main class="app"><div class="wallpaper"></div><canvas class="wallpaper-video"></canvas><div class="scrim"></div></main>',
    );
    await sample.addStyleTag({
      content:
        readFileSync("src/tokens.css", "utf8").replace(
          /^@tailwind[^;]+;/gm,
          "",
        ) +
        "\n" +
        readFileSync("src/window-corners.css", "utf8") +
        "\n*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%}.app{background:var(--surface)}.wallpaper,.scrim,.wallpaper-video{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.wallpaper{background:var(--surface)}.scrim{background:var(--glass-thin)}.wallpaper-video{transform:translateZ(0)}",
    });
    for (const theme of ["light", "dark"]) {
      await sample.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        const c = document.querySelector("canvas");
        c.width = 1080;
        c.height = 720;
        const g = c.getContext("2d");
        g.fillStyle = getComputedStyle(
          document.documentElement,
        ).getPropertyValue("--surface");
        g.fillRect(0, 0, c.width, c.height);
      }, theme);
      const png = await sample.screenshot({ omitBackground: true });
      const details = await sample.evaluate(async (data) => {
        const blob = await (
          await fetch("data:image/png;base64," + data)
        ).blob();
        const img = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const pixels = g.getImageData(0, 0, c.width, c.height).data;
        const alpha = (x, y) => pixels[(y * c.width + x) * 4 + 3];
        const corners = [
          [0, 0],
          [c.width - 1, 0],
          [0, c.height - 1],
          [c.width - 1, c.height - 1],
        ].map(([x, y]) => alpha(x, y));
        let partial = 0;
        const r = Math.ceil(32 * devicePixelRatio);
        for (let y = 0; y < r; y++)
          for (let x = 0; x < r; x++) {
            const a = alpha(x, y);
            if (a > 0 && a < 255) partial++;
          }
        const styles = getComputedStyle(document.querySelector(".app"));
        return {
          corners,
          partial,
          clip: styles.clipPath,
          mask: styles.maskImage,
          border: styles.borderTopStyle,
          after: getComputedStyle(document.querySelector(".app"), "::after")
            .content,
        };
      }, png.toString("base64"));
      assert.deepEqual(details.corners, [0, 0, 0, 0]);
      assert.ok(details.partial > 8, "圆角应有抗锯齿过渡");
      assert.equal(details.clip, "none");
      assert.equal(details.mask, "none");
      assert.equal(details.border, "solid");
      assert.equal(details.after, "none");
      cornerChecks.push({ scale, theme, ...details });
      if (scale === 2 && theme === "light")
        await sample.screenshot({
          path: output + "/corner-2x.png",
          omitBackground: true,
          clip: { x: 0, y: 0, width: 56, height: 56 },
        });
    }
    await sample.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    output + "/result.json",
    JSON.stringify(
      {
        passed: true,
        selectionRestored: true,
        targetIconOnly: true,
        fullCoverFallbacks: true,
        cornerChecks,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 重启保留实例、定向更新图标、默认封面铺满、四种缩放下的明暗主题圆角。",
  );
} finally {
  await browser?.close();
  server.kill();
}
