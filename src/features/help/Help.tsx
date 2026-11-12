import { RELEASE } from "../../lib/release";
import { useState } from "react";
import { Card, Tabs, Badge, Button } from "../../components/ui";
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
    "点右下角的机器人，再点「添加日志」，选最近一次游戏日志或闪退报告。完整报错比单独一串错误编号更容易找到原因。",
  ],
  [
    "皮肤、披风与存档",
    "在「皮肤」里导入 PNG 图片，拖动人物可以转动视角，点击「应用」后才会更换皮肤。在版本的「存档」页可以打开存档文件夹。",
  ],
];
export function Help() {
  const [tab, T] = useState("帮助库");
  return (
    <>
      <div className="page-head">
        <Badge>Kynex Launcher</Badge><Button onClick={() => window.dispatchEvent(new Event("kynex-open-guide"))}>重新查看使用引导</Button>
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
