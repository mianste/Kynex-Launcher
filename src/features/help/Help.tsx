import { RELEASE } from "../../lib/release";
import { useState } from "react";
import { Card, Tabs, Badge } from "../../components/ui";
const topics = [
  [
    "安装第一个版本",
    "打开「下载」，选好游戏版本，再选择原版、Forge 或 Fabric 等。安装好后到「账号」登录，然后回首页启动游戏。",
  ],
  [
    "Forge 与 Fabric 怎么选",
    "看你想装的模组支持哪一个，再安装对应的游戏版本。Forge 和 Fabric 的模组不能混用。",
  ],
  [
    "整合包拖拽导入",
    "把 .mrpack 或整合包 zip 拖进启动器，确认名称后安装。如果提示缺少下载权限，按提示填写 CurseForge 密钥。",
  ],
  [
    "崩溃与日志排查",
    "打开「诊断」，拖入 latest.log 或 crash-reports 文件夹里的报错文件，点击「分析日志」。只看退出码通常找不到原因。",
  ],
  [
    "一键进服与端口",
    "点击「进服」，填写服务器地址。端口默认是 25565。IPv6 地址带端口时写成 [地址]:端口。正版服务器需要正版账号。",
  ],
  [
    "皮肤、披风与一键读档",
    "在「皮肤」里导入 PNG 图片，拖动人物可以转动视角，点击「应用」后才会更换皮肤。在版本的「存档」页可以直接进入已有世界（需要 Minecraft 1.20 或更新版本）。",
  ],
];
export function Help() {
  const [tab, T] = useState("帮助库");
  return (
    <>
      <div className="page-head">
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
        </Card>
      )}
    </>
  );
}
