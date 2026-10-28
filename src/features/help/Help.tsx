import { RELEASE } from "../../lib/release";
import { useState } from "react";
import { Card, Tabs, Badge } from "../../components/ui";
const topics = [
  [
    "安装第一个版本",
    "在「下载」中获取官方版本清单，选择游戏版本，再选择原版或加载器。安装完成后去「账号」登录，再从首页启动。初次安装会下载依赖与资源，耗时取决于网络。",
  ],
  [
    "Forge 与 Fabric 怎么选",
    "两者的模组不能混用。先确认目标模组支持的游戏与加载器版本。Kynex 支持 Fabric / Quilt 元数据安装及 Forge / NeoForge 官方安装器；OptiFine 请从其官网获取。",
  ],
  [
    "整合包拖拽导入",
    "把 .mrpack 或 Kynex 导出的 zip 拖进窗口，确认包名、游戏、加载器与目标名称后安装。CurseForge 包可识别，但文件安装需要额外 API 授权，当前版本会明确提示。",
  ],
  [
    "崩溃与日志排查",
    "打开「诊断」，导入 latest.log 或 crash-reports 中的文本报告。规则覆盖内存、Java、方法签名、依赖、重复模组、Mixin 与 OpenGL。通用退出码不能单独确定原因。",
  ],

];
export function Help() {
  const [tab, T] = useState("帮助库");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>帮助中心</h1>
          <p>把时间留给游戏，把问题交给这里。</p>
        </div>
        <Badge>Kynex Launcher</Badge>
      </div>
      <Tabs items={["帮助库", "更新日志"]} value={tab} onChange={T} />
      {tab === "帮助库" ? (
        <div className="help-grid">
          {topics.map(([title, text], n) => (
            <Card key={title}>
              <span className="help-number">0{n + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Badge>{RELEASE.label}</Badge>
          <h2>更新日志</h2>
          <div className="actions">
            <button
              className="btn"
              onClick={() =>
                window.dispatchEvent(new Event("kynex-open-changelog"))
              }
            >
              查看更新日志弹窗
            </button>
            <button
              className="btn"
              onClick={() =>
                window.dispatchEvent(new Event("kynex-check-update"))
              }
            >
              检查新版本
            </button>
          </div>
          <ul>
            {RELEASE.changes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            完整支持范围、尚未接入项和构建步骤见项目 docs/STATUS.md 与
            docs/BUILD.md。
          </p>
        </Card>
      )}
    </>
  );
}
