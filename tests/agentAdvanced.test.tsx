import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/store", () => ({ useStore: () => ({}) }));
vi.mock("../src/lib/bridge", () => ({
  desktop: false,
  api: vi.fn(),
  readableSize: (n: number) => `${n} B`,
}));
import {
  AgentAdvanced,
  PerformancePreview,
  ShareImport,
  TemplateGallery,
} from "../src/features/assistant/AgentAdvanced";
import {
  ScreenshotPreviews,
  VoiceInput,
  fittedSize,
  validateScreenshot,
  MAX_MEDIA,
} from "../src/features/assistant/AssistantMedia";
import {
  InsightPanel,
  unreadInsights,
} from "../src/features/assistant/AgentInsights";
import type { AgentTask } from "../src/features/assistant/agentStore";
describe("P2 工坊界面", () => {
  it("shows update, migration, share, performance and source-preserving notices", () => {
    const task = {
      id: "x",
      status: "done",
      confirmedHash: "a",
      planHash: "a",
      results: {},
    } as AgentTask;
    const html = renderToStaticMarkup(
      <>
        <AgentAdvanced task={task} group="versions" />
        <AgentAdvanced task={task} group="share" />
        <AgentAdvanced task={task} group="performance" />
      </>,
    );
    for (const text of [
      "检查整合包更新",
      "恢复到更新前",
      "查看换版本方案",
      "旧的还可以继续玩",
      "生成分享码",
      "分析硬件与当前配置",
    ])
      expect(html).toContain(text);
  });
  it("renders real hardware and before/after without claiming FPS gains", () => {
    const html = renderToStaticMarkup(
      <PerformancePreview
        data={{
          hardware: {
            cpu: "测试 CPU",
            logicalCores: 8,
            memoryMb: 16384,
            gpus: [{ name: "测试显卡", vramMb: 4096 }],
          },
          current: { memoryMb: 2048, modCount: 6 },
          proposal: {
            memoryMb: 4096,
            options: { renderDistance: 10 },
            mods: [{ name: "Sodium" }],
          },
        }}
      />,
    );
    for (const text of [
      "测试 CPU",
      "测试显卡",
      "2048",
      "4096",
      "渲染距离",
      "不承诺 FPS 提升",
    ])
      expect(html).toContain(text);
  });
  it("offers schema-checked template and share import entry points", () => {
    const html = renderToStaticMarkup(
      <>
        <TemplateGallery onSelect={() => {}} />
        <ShareImport />
      </>,
    );
    expect(html).toContain("玩法模板");
    expect(html).toContain("导入分享码");
    expect(html).not.toContain("<summary");
  });
  it("limits screenshots and scales longest side to 2048", () => {
    expect(fittedSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fittedSize(100, 50)).toEqual({ width: 100, height: 50 });
    for (const type of ["image/png", "image/jpeg", "image/webp"])
      expect(() => validateScreenshot({ type, size: 1024 })).not.toThrow();
    expect(() =>
      validateScreenshot({ type: "image/svg+xml", size: 30 }),
    ).toThrow();
    expect(() =>
      validateScreenshot({ type: "image/png", size: MAX_MEDIA + 1 }),
    ).toThrow();
    const html = renderToStaticMarkup(
      <ScreenshotPreviews
        images={[{ id: "a", name: "截图", data: "data:image/png;base64,AA==" }]}
        remove={() => {}}
      />,
    );
    expect(html).toContain("移除截图");
  });
  it("hides microphone until a voice service is configured", () => {
    expect(
      renderToStaticMarkup(
        <VoiceInput disabled={false} onText={() => {}} onError={() => {}} />,
      ),
    ).toBe("");
  });
  it("shows reminders with explicit ignore periods and clears unread state", () => {
    const items = [
      {
        key: "a",
        kind: "crash",
        title: "重复崩溃",
        message: "请分析日志",
        seen: false,
      },
    ];
    expect(unreadInsights(items)).toBe(true);
    expect(unreadInsights(items.map((v) => ({ ...v, seen: true })))).toBe(
      false,
    );
    const html = renderToStaticMarkup(
      <InsightPanel
        items={items}
        error=""
        dismiss={async () => {}}
        refresh={async () => {}}
      />,
    );
    for (const text of ["重复崩溃", "忽略 7 天", "永久忽略", "不会自动修改"])
      expect(html).toContain(text);
  });
});
