import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { FormattedAnswer } from "../src/features/assistant/FormattedAnswer";
describe("assistant reports", () => {
  it("formats model headings, emphasis and steps", () => {
    const html = renderToStaticMarkup(
      <FormattedAnswer
        text={"## 结论\n**缺少前置**\n1. 检查版本\n2. 安装 `Fabric API`"}
      />,
    );
    expect(html).toContain("<h3>结论</h3>");
    expect(html).toContain("<strong>缺少前置</strong>");
    expect(html).toMatch(/<ol(?:\s[^>]*)?>/);
    expect(html).toContain("<code>Fabric API</code>");
    expect(html).not.toContain("##");
    expect(html).not.toContain("**");
  });
  it("keeps error code readable and escapes model-supplied HTML", () => {
    const html = renderToStaticMarkup(
      <FormattedAnswer
        text={"```log\n# crash **evidence**\n<script>alert(1)</script>\n```"}
      />,
    );
    expect(html).toContain("<pre><code>");
    expect(html).toContain("# crash **evidence**");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("preserves versions and file globs while formatting spaced troubleshooting steps", () => {
    const html = renderToStaticMarkup(
      <FormattedAnswer
        text={
          "###排查步骤\nNeoForge 21.1.230，Java 21.0.13。\n\n1. 打开 crash-reports，找 crash-*.txt。\n\n2. 查看 *.log，保留 **首个异常**。\n   然后重新启动验证。\n\n3. 安装 `Fabric API`。"
        }
      />,
    );
    expect(html).toContain("NeoForge 21.1.230，Java 21.0.13。");
    expect(html.match(/<ol(?:\s[^>]*)?>/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("crash-*.txt</code>");
    expect(html).toContain("*.log</code>");
    expect(html).toContain("<strong>首个异常</strong>");
    expect(html).not.toContain("**");
    expect(html).toContain("然后重新启动验证。");
  });
  it("formats triple emphasis and model tables without displaying formatting markers", () => {
    const html = renderToStaticMarkup(
      <FormattedAnswer
        text={
          "***先备份***，再检查 ~~旧版本~~。\n\n| 模组 | 用途 |\n| --- | --- |\n| **Sodium** | 性能优化 |"
        }
      />,
    );
    expect(html).toContain("<strong><em>先备份</em></strong>");
    expect(html).toContain("<del>旧版本</del>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("***");
    expect(html).not.toContain("| ---");
  });
});
