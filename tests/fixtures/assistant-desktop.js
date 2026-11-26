export async function installAssistantFixture(page) {
  await page.addInitScript(() => {
    window.isTauri = true;
    let id = 0;
    window.calls = [];
    window.failTest = false;
    window.skinSavePath = "C:/fixture/exported-skin.png";
    window.failSkinExport = false;
    window.logPath = "C:/fixture/logs/latest.log";
    window.menuFrames = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || !node.matches(".choice-popover"))
            continue;
          let frames = 0;
          const sample = () => {
            if (!node.isConnected) return;
            const style = getComputedStyle(node);
            window.menuFrames.push({
              opacity: style.opacity,
              transform: style.transform,
              transition: style.transitionDuration,
              animation: style.animationName,
            });
            if (++frames < 8) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }
    }).observe(document, { childList: true, subtree: true });
    const instance = {
      id: "test",
      name: "Fabric 测试实例",
      version: "1.20.1",
      loader: "fabric",
      game: "java",
      path: "C:/fixture",
      settings: {
        memory: 4096,
        java: "C:/old-java.exe",
        width: 1280,
        height: 720,
        isolation: "all",
      },
    };
    let models = {
      active: "deepseek",
      items: [
        {
          id: "deepseek",
          name: "DeepSeek",
          model: "deepseek-flash",
          endpoint: "https://api.deepseek.com/chat/completions",
          configured: false,
        },
      ],
    };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => ++id,
      unregisterCallback: () => {},
      convertFileSrc: (p) => p,
      invoke: async (cmd, args) => {
        if (cmd === "plugin:dialog|save") return window.skinSavePath;
        if (cmd === "plugin:dialog|open") {
          window.logDialogOptions = args.options;
          return window.logPath;
        }
        if (cmd !== "dispatch") return 1;
        const { action, payload: p } = args;
        window.calls.push({ action, payload: p });
        if (action === "read_log")
          return "java.lang.OutOfMemoryError: Java heap space";
        if (action === "skin_export") {
          if (window.failSkinExport) throw Error("保存位置没有写入权限");
          return p.path;
        }
        if (action === "game_directories")
          return {
            activeId: "qa",
            items: [
              {
                id: "qa",
                name: "测试目录",
                path: "C:/fixture",
                available: true,
              },
            ],
          };
        if (
          action === "resources" ||
          action === "datapack_worlds" ||
          action === "java"
        )
          return [];
        if (action === "news") return { articles: [], source: "fixture" };
        if (action === "manifest")
          return [
            {
              id: "1.20.1",
              type: "release",
              releaseTime: "2023-06-12T00:00:00Z",
            },
          ];
        if (action === "list_instances")
          return location.search.includes("emptyInstances") ? [] : [instance];
        if (
          ["list_accounts", "detect_games", "hydrate_pack_icons"].includes(
            action,
          )
        )
          return [];
        if (action === "check_update") {
          if (location.search.includes("deferUpdate"))
            await new Promise((resolve) => {
              window.finishUpdate = resolve;
            });
          return {
            status: "available",
            update: { version: "9.0.0", notes: "测试更新，不会安装" },
          };
        }
        if (action === "hotfix_status")
          return { revision: 0, canRollback: false };
        if (action === "hotfix_check") return { status: "unpublished" };
        if (action === "ai_options") return { automatic: true };
        if (action === "ai_models") {
          if (p.op === "save") {
            const v = { ...p, id: p.id || "custom", configured: true };
            delete v.key;
            models = { active: v.id, items: [models.items[0], v] };
          }
          return models;
        }
        if (action === "ai_test_connection") {
          if (window.failTest) throw Error("API Key 无效或没有权限");
          return { ok: true, model: p.model, reply: "OK", elapsedMs: 123 };
        }
        if (action === "ai_assistant") {
          if (window.deferAi)
            await new Promise((resolve) => (window.finishAssistant = resolve));
          return {
            reply:
              "## 搭配建议\n\n**先明确核心玩法**，再逐项添加模组。Fabric 1.20.1，Java 17。\n\n1. 加入小地图模组，便于冒险导航。\n\n2. 发生报错时查看 crash-*.txt 和 `latest.log`。\n\n3. 每次添加后启动验证，避免一次安装过多模组。",
            searches: [],
            recommendations: [
              {
                name: "Xaero's Minimap",
                query: "Xaero's Minimap",
                category: "辅助体验",
                reason:
                  "为冒险生存提供地图导航；安装前核对 Fabric 1.20.1 版本。",
              },
            ],
          };
        }
        if (action === "search")
          return {
            hits: [
              {
                project_id: "minimap",
                title: "Xaero's Minimap",
                description: "小地图测试结果",
                downloads: 1000,
                slug: "minimap",
                project_type: "mod",
                source: p.source,
              },
            ],
            total: 1,
          };
        if (action === "project_versions")
          return {
            versions: [
              {
                id: "v1",
                name: "Fabric 1.20.1",
                number: "1",
                compatible: true,
                type: "release",
                date: "2026-01-01",
              },
            ],
          };
        if (action === "resource_requirements")
          return { dependencies: [], notes: [] };
        if (action === "ai_diagnose")
          return {
            report:
              "## 结论\n**内存不足**，可提高实例内存后重新启动验证。\n- 保留系统可用内存\n- 再次启动验证",
          };
        if (action === "save_instance") {
          instance.settings = p.settings;
          return instance;
        }
        return true;
      },
    };
  });
  // END_DESKTOP_FIXTURE
}
