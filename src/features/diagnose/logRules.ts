import type { Diagnostic } from "../../lib/types";
interface Rule {
  id: string;
  pattern: RegExp;
  title: string;
  severity: "bad" | "warn";
  advice: string;
}
const rules: Rule[] = [
  {
    id: "oom",
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    title: "内存不足，堆空间耗尽",
    severity: "bad",
    advice:
      "提高本实例的内存分配，并为系统预留至少 2 GB。大型整合包可尝试 6144 MB。",
  },
  {
    id: "java",
    pattern: /UnsupportedClassVersionError|class file version \d+/i,
    title: "Java 版本不兼容",
    severity: "bad",
    advice:
      "按版本要求切换 Java。class 61 对应 Java 17，class 65 对应 Java 21。",
  },
  {
    id: "method",
    pattern: /NoSuchMethodError|NoSuchFieldError/i,
    title: "组件或模组版本不匹配",
    severity: "bad",
    advice: "核对报错类所属模组及其依赖版本，更新或回退到相互兼容的版本。",
  },
  {
    id: "dependency",
    pattern:
      /Missing.*depend|requires.*(?:version|mod)|depends on.*missing|Incompatible mod set/i,
    title: "缺少依赖或依赖版本错误",
    severity: "bad",
    advice: "根据日志提示补齐前置模组，并确认游戏与加载器版本一致。",
  },
  {
    id: "duplicate",
    pattern: /DuplicateModsFoundException|Duplicate mod|Found duplicate mods/i,
    title: "检测到重复模组",
    severity: "bad",
    advice: "检查 mods 目录中同一模组的多个版本，保留一个兼容版本。",
  },
  {
    id: "mixin",
    pattern:
      /MixinApplyError|MixinTransformerError|Mixin.*failed|InjectionError/i,
    title: "Mixin 注入失败",
    severity: "bad",
    advice:
      "从最早出现的 Mixin 报错查找所属模组，核对加载器和前置依赖，排除兼容性冲突。",
  },
  {
    id: "gl",
    pattern:
      /GLFW error|OpenGL.*(?:error|support)|Failed to create window|Pixel format not accelerated/i,
    title: "图形环境或驱动异常",
    severity: "bad",
    advice:
      "安装显卡厂商提供的驱动，确认使用独立显卡并满足游戏的 OpenGL 要求。",
  },
  {
    id: "exit",
    pattern: /exit code\s*[:=]?\s*-1|Process exited.*-1|退出码.*-1/i,
    title: "游戏异常退出，需要更多线索",
    severity: "warn",
    advice:
      "退出码 -1 不能确定根因。请导入 latest.log 和 crash-reports 中的完整报告。",
  },
];
export function diagnose(text: string): Diagnostic[] {
  const lines = text.split(/\r?\n/);
  const matches = rules
    .map((rule) => ({
      ...rule,
      lines: lines
        .flatMap((text, n) =>
          rule.pattern.test(text) ? [{ number: n + 1, text }] : [],
        )
        .slice(0, 8),
    }))
    .filter((r) => r.lines.length > 0);
  const detailed = matches.some((x) => x.id !== "exit");
  return matches
    .filter((x) => !detailed || x.id !== "exit")
    .map(({ pattern: _, ...r }) => r);
}
