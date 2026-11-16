import type { Page } from "../../lib/types";

export type GuideStep = {
  page: Page;
  target?: string;
  selector?: string;
  section?: string;
  title: string;
  text: string;
  requiresInstance?: boolean;
  assistant?: boolean;
};

export const GUIDE_STEPS: GuideStep[] = [
  {
    page: "home",
    target: "navigation-toggle",
    title: "顶部导航",
    text: "靠近刘海可临时切换导航，点击可收起或打开。",
  },
  {
    page: "home",
    selector: ".home-launch-controls",
    title: "进入游戏",
    text: "点启动箭头切换版本。左下角可编辑首页组件，点确定应用布局。",
  },
  {
    page: "library",
    selector: ".page-content .page-head",
    title: "管理版本",
    text: "在这里打开已安装的实例，查看模组、资源和存档。",
  },
  {
    page: "discover",
    target: "download-categories",
    section: "游戏本体",
    title: "下载游戏与资源",
    text: "选择游戏版本和加载器，也可以在这里搜索整合包和模组。",
  },
  {
    page: "workshop",
    selector: ".agent-panel .agent-controls",
    section: "overview",
    title: "整合包工坊（测试）",
    text: "从玩法模板开始，或选择已有实例进行维护。",
  },
  {
    page: "settings",
    section: "界面",
    selector: ".theme-choices",
    title: "切换主题",
    text: "在设置的「界面」里选择浅色、深色、跟随系统或自定义配色。",
  },
  {
    page: "home",
    selector: ".assistant-orb",
    title: "打开 AI 助手",
    text: "右下角机器人可以回答启动问题，也可以帮你分析游戏日志。",
  },
];
