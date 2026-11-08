/**
 * 安装窗口的入参：可以是单纯的游戏版本，也可以是「游戏版本|加载器」。
 * 下载页的加载器目录用后者把预选加载器带进安装窗口。
 */
export function parseInstallTarget(data?: string): {
  version: string;
  preset?: string;
} {
  const [version, preset] = (data ?? "1.20.1").split("|");
  return {
    version: version || "1.20.1",
    preset: preset || undefined,
  };
}
