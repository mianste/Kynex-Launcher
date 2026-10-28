import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Play,
  ChevronDown,
  Heart,
  Box,
  Globe,
  FolderOpen,
  Plus,
  PackagePlus,
  Gamepad2,
  Castle,
  Swords,
  Map,
  Music2,
} from "lucide-react";
import { useStore, launch, guarded } from "../../store";
import { Button, Badge } from "../../components/ui";
import { api, desktop, external, pickFile } from "../../lib/bridge";

export function Home() {
  const s = useStore();
  const instance = s.instances.find((item) => item.id === s.selected);
  const account = s.accounts.find((item) => item.id === s.accountId);
  async function importPack() {
    const path = await pickFile([
      { name: "整合包", extensions: ["zip", "mrpack", "curseforge"] },
    ]);
    if (path) s.show("pack", path);
  }
  return (
    <div className="home-layout">
      <header className="home-header">
        <div className="actions">
          <button
            className="support"
            onClick={() =>
              guarded(() => external("https://afdian.com/a/keke_657"))
            }
          >
            <Heart size={14} /> 爱发电
          </button>
        </div>
      </header>
      <div className="home-dashboard">
        <section className="home-quick-panel">
          <h2>常用入口</h2>
          <div className="home-shortcuts">
            <button onClick={() => guarded(importPack)}>
              <span>
                <PackagePlus size={23} />
              </span>
              <b>导入整合包</b>
              <small>ZIP / MRPACK</small>
            </button>
          </div>
          <div className="home-recent-head">
            <h2>最近的实例</h2>
            <button onClick={() => s.setPage("library")}>
              全部版本 <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="home-recent">
            {s.instances.slice(0, 2).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  useStore.setState({ selected: item.id });
                  s.setPage("instance");
                }}
              >
                <span className="home-instance-icon">
                  {item.icon ? (
                    <img src={item.icon} alt="" />
                  ) : (
                    <Box size={20} />
                  )}
                </span>
                <span>
                  <b>{item.name}</b>
                  <small>
                    Minecraft {item.version} / {item.loader}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!s.instances.length && (
              <button onClick={() => s.setPage("discover")}>
                <Plus size={20} />
                <span>
                  <b>安装第一个版本</b>
                  <small>选择游戏版本与加载器</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </section>
        <aside className="launch-column">
          <button className="account-tile" onClick={() => s.setPage("account")}>
            <div className="avatar">
              {account?.skin || s.skin ? (
                <i
                  className="avatar-head"
                  style={{ backgroundImage: `url(${account?.skin || s.skin})` }}
                />
              ) : (
                (account?.name.slice(0, 1).toUpperCase() ?? "K")
              )}
            </div>
            <div>
              <b>{account?.name ?? "添加你的第一个账号"}</b>
              <small>
                {account
                  ? {
                      offline: "离线账号",
                      microsoft: "Microsoft 正版",
                      external: "外置认证",
                    }[account.kind]
                  : "Microsoft / 离线 / 外置认证"}
              </small>
            </div>
            <ArrowUpRight size={16} />
          </button>
          <div className="glass launch-card">
            <div className="launch-status">
              <i />
              Java 版<Badge tone="ok">本地游戏库</Badge>
            </div>
            <h2>准备好出发了吗？</h2>
            <button className="version-link" onClick={() => s.show("versions")}>
              {instance?.name ?? "选择或安装版本"}
              <ChevronDown size={15} />
            </button>
            <div className="launch-meta">
              <span>
                {instance?.loader ?? "原版"}
                {instance?.loader === "forge" && instance.optifineVersion
                  ? " + OptiFine"
                  : ""}
              </span>
              <span>{instance?.settings.memory ?? s.settings.memory} MB</span>
            </div>
            <div className="launch-buttons">
              <Button primary busy={s.busy} onClick={() => void launch()}>
                <Play size={19} />
                {s.busy ? "正在准备…" : "进入游戏"}
              </Button>
            </div>
            <button
              className="text-button"
              onClick={() => s.setPage("library")}
            >
              <FolderOpen size={13} /> 管理版本与存档 <ArrowUpRight size={12} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
