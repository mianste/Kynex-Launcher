import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const output = "ui-report/agent-p2";
mkdirSync(output, { recursive: true });
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1463"],
  { stdio: "ignore", windowsHide: true },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1463")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const old = readFileSync("tests/fixtures/assistant-desktop.js", "utf8");
  let fixture = old.slice(
    old.indexOf("await page.addInitScript(() => {"),
    old.indexOf("  // END_DESKTOP_FIXTURE"),
  );
  fixture = fixture.replace(
    "let id = 0;",
    `let id=0;const callbacks={},listeners={};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,id)=>delete listeners[id]};window.emitAI=p=>{for(const [id,item]of Object.entries(listeners))if(item.event==='kynex-ai-stream')callbacks[item.handler]?.({event:item.event,id:Number(id),payload:p});};`,
  );
  fixture = fixture.replace(
    "transformCallback: () => ++id,",
    "transformCallback:callback=>{callbacks[++id]=callback;return id;},",
  );
  fixture = fixture.replace(
    'if (cmd !== "dispatch") return 1;',
    `if(cmd==='plugin:event|listen'){const key=++id;listeners[key]=args;return key;}if(cmd==='plugin:event|unlisten'){delete listeners[args.eventId];return null;}if(cmd!=='dispatch')return 1;`,
  );
  fixture = fixture.replace(
    "window.calls = [];",
    `window.calls=[];window.vision=false;window.voice=false;window.insights=[{key:'crash:x',kind:'crash',title:'实例重复崩溃',message:'请查看日志',instanceId:'test',seen:false}];window.plan={version:1,name:'P2 测试包',minecraft:'1.20.1',loader:{type:'fabric',version:'0.20.1'},memoryMb:4096,java:'auto',mods:[],resourcePacks:[],shaders:[],localization:{mode:'none',note:''},options:{language:'zh_cn'},configPatches:[],notes:[],warnings:[],estimatedDownloadBytes:1024};window.task={id:'p2-task',mode:'confirm',status:'done',request:'制作整合包',plan:window.plan,planHash:'hash',confirmedHash:'hash',steps:[],currentStep:10,budget:{downloadedBytes:0},audit:[],createdAt:'1',updatedAt:'1',error:'',directoryId:'qa',instanceId:'test',snapshots:['snapshot'],rollbackSnapshot:'snapshot',results:{}};`,
  );
  fixture = fixture.replace(
    "window.calls.push({ action, payload: p });",
    `window.calls.push({action,payload:p});if(action==='check_update')return {status:'current'};if(action==='agent_list')return [window.task];if(action==='agent_get')return window.task;
 if(action==='ai_models'&&(!p.op||p.op==='list'))return {active:'deepseek',items:[{id:'deepseek',name:'DeepSeek',model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',configured:true,supportsVision:window.vision}]};
 if(action==='ai_voice_config'){if(p.op==='save')window.voice=true;if(p.op==='clear')window.voice=false;return {configured:window.voice,endpoint:window.voice?'http://localhost:9000/v1/audio/transcriptions':'',model:window.voice?'local-whisper':''};}
 if(action==='assistant_read_screenshot')return {base64:window.dropPng,mime:'image/png'};
 if(action==='voice_transcribe')return {text:'我的 Minecraft 启动失败'};
 if(action==='ai_assistant_stream'){setTimeout(()=>{window.emitAI({requestId:p.requestId,delta:'截图中的 Minecraft 错误'});window.emitAI({requestId:p.requestId,done:true,reply:'截图中的 Minecraft 错误可先检查 Java。',model:'vision-test',elapsedMs:100});},30);return {accepted:true};}
 if(action==='agent_import_plan'){if(!p.confirmed)throw Error('未确认');return {task:{...window.task,id:'imported',status:'awaiting_approval',confirmedHash:''}};}
 if(action==='agent_attach')return {task:{...window.task,maintenance:true,status:'awaiting_approval',confirmedHash:''}};
 if(action==='agent_tool'){
 if(p.tool==='insights_list'){if(p.args.markRead)window.insights=window.insights.map(v=>({...v,seen:true}));return window.insights;}
 if(p.tool==='insights_check')return window.insights;if(p.tool==='insights_dismiss'){window.insights=[];return {dismissed:true};}
 if(p.tool==='template_list')return [{id:'adventure',name:'轻量冒险',description:'探索寻路',minecraft:'1.20.1',loader:'fabric',memoryMb:4096}];if(p.tool==='template_apply')return {request:'制作一个 Minecraft 轻量冒险整合包'};
 if(p.tool==='pack_update_check')return {updateHash:'update-hash',preview:{available:true,current:{versionNumber:'1.0'},candidate:{versionNumber:'1.1',notes:'修复兼容性',estimatedDownloadBytes:128},downloadBytes:512,differences:{added:['mods/new.jar'],changed:['config/a.json'],removed:['mods/old.jar'],preserved:['config/a.json']},warnings:[]}};
 if(p.tool==='pack_update_apply'){if(!p.confirmed||p.args.updateHash!=='update-hash')throw Error('未确认更新');const result={updated:true,rollbackSnapshotId:'update-snapshot',note:'更新验证通过'};window.task.results.pack_update_apply=result;return result;}
 if(p.tool==='pack_update_rollback')return {restored:true,note:'已恢复更新前的文件和整合包来源。'};
 if(p.tool==='migration_plan')return {migrationHash:'migration-hash',plan:{sourceInstanceId:'test',target:{minecraft:p.args.target.minecraft,loader:p.args.target.loader,loaderVersion:'0.20.1'},mappings:[{name:'地图',action:'replace',reason:'找到兼容版本',newProjectId:'actual',newVersionId:'version'}],unresolved:['local.jar（未识别）'],configWarnings:['旧配置需核对'],estimatedDownloadBytes:100}};
 if(p.tool==='migration_apply'){if(!p.confirmed||!p.args.allowUnresolved||p.args.copySaves)throw Error('迁移确认缺失');return {migrated:true,sourceUnchanged:true,note:'迁移验证通过'};}
 if(p.tool==='share_code_create')return {code:'KXL1.fixture.12345678'};if(p.tool==='share_code_import')return {plan:window.plan,importHash:'hash'};if(p.tool==='share_code_save')return {saved:true,location:'当前游戏目录 exports/'};
 if(p.tool==='performance_analyze')return {hardware:{cpu:'测试 CPU',logicalCores:8,memoryMb:16384,gpus:[{name:'测试显卡',vramMb:4096}]},current:{memoryMb:2048,modCount:3,shaderCount:0},proposal:{memoryMb:4096,options:{renderDistance:10},mods:[]},performanceHash:'performance-hash'};
 if(p.tool==='performance_apply'){if(!p.confirmed||p.args.performanceHash!=='performance-hash')throw Error('性能确认缺失');return {applied:true,note:'未测量 FPS；不承诺帧率提升。'};}return {};
 }`,
  );
  await new Function("page", `return (async()=>{${fixture}})()`)(page);
  const build = JSON.parse(readFileSync("config/build-channel.json", "utf8"));
  await page.addInitScript(({ channel, version }) => {
    localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
    localStorage.setItem("kynex-release-seen-" + channel, version);
  }, build);
  await page.goto("http://127.0.0.1:1463/?nosplash=1");
  await page.waitForFunction(() => !!document.querySelector(".assistant-dot"));
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".assistant-dot"));
  await page.locator(".agent-insights>summary").click();
  await page.getByRole("button", { name: "忽略 7 天", exact: true }).click();
  await page
    .getByText("实例重复崩溃", { exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "按住说话", exact: true }).count(),
    0,
  );
  if (!process.env.KXL_UI_MEDIA_ONLY) {
    await page.getByRole("button", { name: "整合包工坊", exact: true }).click();
    const panel = page.getByRole("region", { name: "AI 整合包工坊" });
    await panel.getByRole("button", { name: "玩法模板", exact: true }).click();
    await page
      .getByRole("dialog", { name: "从玩法模板开始" })
      .getByRole("button", { name: /轻量冒险/ })
      .click();
    assert.match(
      await panel.getByLabel("想制作什么整合包？").inputValue(),
      /轻量冒险/,
    );
    await panel
      .getByRole("button", { name: "更新与迁移", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "检查整合包更新", exact: true })
      .click();
    await panel.getByText("1.0 → 1.1", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "更新并验证", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() =>
        window.calls.some(
          (c) =>
            c.action === "agent_tool" && c.payload.tool === "pack_update_apply",
        ),
      ),
      false,
    );
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await panel.getByText("更新验证通过", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "恢复到更新前", exact: true })
      .click();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await panel
      .getByText("已恢复更新前的文件和整合包来源。", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "检查整合包更新", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "忽略此版本", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "检查整合包更新", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "清除忽略记录", exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "查看换版本方案", exact: true })
      .click();
    await panel.getByText("local.jar（未识别）", { exact: true }).waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: "确认换版本方案", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await panel
        .getByRole("checkbox", { name: /单独备份并复制存档/ })
        .isChecked(),
      false,
    );
    await panel.getByRole("checkbox", { name: /我确认这些项目不迁移/ }).check();
    await panel
      .getByRole("button", { name: "确认换版本方案", exact: true })
      .click();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await panel.getByText("迁移验证通过", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "导出与分享", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "生成分享码", exact: true })
      .click();
    await panel
      .getByRole("textbox", { name: "生成的分享码", exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "保存 .kxlpack", exact: true })
      .click();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await panel
      .getByText("保存位置：当前游戏目录 exports/", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "配置与排错", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "分析硬件与当前配置", exact: true })
      .click();
    await panel
      .getByText("测试显卡 · 4096 MB 专用显存", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "应用并验证", exact: true })
      .click();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await panel
      .getByText("未测量 FPS；不承诺帧率提升。", { exact: true })
      .waitFor();
    await page.screenshot({ path: output + "/advanced.png" });
    await panel
      .getByRole("button", { name: "导入分享码", exact: true })
      .click();
    const importDialog = page.getByRole("dialog", {
      name: "导入分享码或 .kxlpack",
    });
    await importDialog
      .getByRole("textbox", { name: "分享码", exact: true })
      .fill("KXL1.fixture.12345678");
    await importDialog
      .getByRole("button", { name: "检查并预览", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "预览分享计划", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.calls.some((c) => c.action === "agent_import_plan"),
      ),
      false,
    );
    await page
      .getByRole("button", { name: "确认导入为新任务", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "开始搭建", exact: true })
      .waitFor();
    await panel.getByRole("button", { name: "返回对话", exact: true }).click();
  }
  const input = page.getByRole("textbox", {
    name: "发给 AI 助手的消息",
    exact: true,
  });
  const send = page.getByRole("button", { name: "发送", exact: true });
  assert.equal(await send.isDisabled(), true, "空消息不能发送");
  await page.getByLabel("选择截图", { exact: true }).setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        canvas.getContext("2d").fillRect(0, 0, 2, 2);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    ),
  });
  await page.getByRole("button", { name: "移除截图", exact: true }).waitFor();
  assert.equal(await send.isEnabled(), true, "只有截图也能发送");
  await page.getByRole("button", { name: "移除截图", exact: true }).click();
  assert.equal(
    await send.isDisabled(),
    true,
    "移除最后一张截图后不能发送空消息",
  );
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#152a25";
    paint.fillRect(0, 0, 640, 360);
    paint.fillStyle = "#bce8d3";
    paint.font = "bold 40px sans-serif";
    paint.fillText("Minecraft", 40, 100);
    paint.font = "24px monospace";
    paint.fillText("OutOfMemoryError", 40, 180);
    paint.fillText("Java heap space", 40, 224);
    window.dropPng = canvas.toDataURL("image/png").split(",")[1];
    const box = document
      .querySelector(".assistant-compose")
      .getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("kynex-assistant-native-drop", {
        cancelable: true,
        detail: {
          paths: ["C:/fixture/screenshot.png"],
          position: {
            x: (box.left + 20) * devicePixelRatio,
            y: (box.top + 20) * devicePixelRatio,
          },
        },
      }),
    );
  });
  await page.getByRole("button", { name: "移除截图", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((c) => c.action === "assistant_read_screenshot"),
    ),
    true,
  );
  await input.fill("   ");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "当前模型不支持图片" })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((c) => c.action === "ai_assistant_stream"),
    ),
    false,
  );
  await page.evaluate(() => (window.vision = true));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByText("截图中的 Minecraft 错误可先检查 Java。", { exact: true })
    .waitFor();
  const imageRequest = await page.evaluate(
    () => window.calls.find((c) => c.action === "ai_assistant_stream").payload,
  );
  assert.equal(imageRequest.images.length, 1, "截图必须随请求发送");
  assert.match(imageRequest.images[0], /^data:image\/png;base64,/);
  assert.match(imageRequest.messages.at(-1).content, /截图/);
  assert.equal(await send.isDisabled(), true, "发送后空输入框应恢复禁用状态");
  const sentImage = page
    .getByRole("button", { name: "查看已发送的第 1 张截图", exact: true })
    .first();
  await sentImage.waitFor();
  assert.equal(
    await sentImage
      .locator("img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await sentImage.click();
  const imageViewer = page.getByRole("dialog", {
    name: "已发送的截图",
    exact: true,
  });
  await imageViewer.waitFor();
  assert.equal(
    await imageViewer.locator("img").getAttribute("src"),
    imageRequest.images[0],
  );
  await page.keyboard.press("Escape");
  await imageViewer.waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "移除截图", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage
        .getItem("kynex-assistant-sessions-v1")
        .includes("data:image/webp"),
    ),
    true,
  );
  await page.getByLabel("选择截图", { exact: true }).setInputFiles({
    name: "with-question.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageRequest.images[0].split(",")[1], "base64"),
  });
  await page.getByRole("button", { name: "移除截图", exact: true }).waitFor();
  await input.fill("分析 Minecraft 截图中的错误");
  await input.press("Enter");
  await page.waitForFunction(
    () =>
      window.calls.filter((c) => c.action === "ai_assistant_stream").length ===
      2,
  );
  const questionRequest = await page.evaluate(
    () =>
      window.calls.filter((c) => c.action === "ai_assistant_stream").at(-1)
        .payload,
  );
  assert.equal(questionRequest.images.length, 1);
  assert.equal(
    questionRequest.messages.at(-1).content,
    "分析 Minecraft 截图中的错误",
  );
  await page.waitForFunction(
    () => !document.querySelector(".assistant-thinking"),
  );
  assert.equal(await page.locator(".assistant-sent-images img").count(), 2);
  await page.screenshot({ path: output + "/sent-images.png" });
  await page.evaluate(() => {
    window.voice = true;
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      constructor() {
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["audio"], { type: "audio/webm" }),
        });
        this.onstop?.();
      }
    }
    window.MediaRecorder = Recorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                window.tracksStopped = true;
              },
            },
          ],
        }),
      },
    });
    window.dispatchEvent(new Event("kynex-voice-config"));
  });
  const mic = page.getByRole("button", { name: "按住说话", exact: true });
  await mic.waitFor();
  await mic.scrollIntoViewIfNeeded();
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.getByText("录音中 · 松开转写", { exact: true }).waitFor();
  await page.mouse.up();
  await page.waitForFunction(() =>
    document
      .querySelector('textarea[data-guide="assistant-chat"]')
      .value.includes("我的 Minecraft 启动失败"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.action === "ai_assistant_stream").length,
    ),
    2,
  );
  assert.equal(await page.evaluate(() => window.tracksStopped), true);
  await page.screenshot({ path: output + "/media.png" });
  assert.equal(
    await page.locator(".assistant-panel").evaluate((e) => e.scrollLeft),
    0,
  );
  await page.reload();
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  assert.equal(
    await page.locator(".assistant-sent-images img").count(),
    2,
    "重开后历史中仍应显示截图预览",
  );
  await page.locator(".assistant-message.user").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/sent-images-history.png" });
  assert.deepEqual(errors, []);
  writeFileSync(
    output + "/ui-result.json",
    JSON.stringify(
      {
        passed: true,
        mediaOnly: !!process.env.KXL_UI_MEDIA_ONLY,
        checks: [
          "更新预览/确认/回滚/按版本忽略",
          "迁移分类/原实例保护/存档默认关闭",
          "分享预览后确认导入与保存",
          "性能前后对比与确认",
          "模板填入可编辑需求",
          "截图预览/模型能力拦截/发送后消息内显示/点开查看/历史压缩预览",
          "语音按住/松开转写/释放麦克风/不自动发送",
          "提醒已读红点消除/忽略7天",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: P2 更新、迁移、分享、性能、模板、截图、语音、提醒全部界面流程。",
  );
} catch (e) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    await page?.screenshot({ path: output + "/failure.png" }).catch(() => {});
    if (page)
      writeFileSync(
        output + "/failure-layout.json",
        JSON.stringify(
          await page.evaluate(() =>
            Array.from(
              document.querySelectorAll(
                '.assistant-panel,.assistant-header,.assistant-body,.assistant-compose,.assistant-quick-actions,[aria-label="按住说话"]',
              ),
            ).map((e) => ({
              className: e.className,
              text: e.getAttribute("aria-label"),
              scrollLeft: e.scrollLeft,
              scrollWidth: e.scrollWidth,
              clientWidth: e.clientWidth,
              rect: e.getBoundingClientRect().toJSON(),
            })),
          ),
          null,
          2,
        ),
      );
  }
  throw e;
} finally {
  await browser?.close();
  server.kill();
}
