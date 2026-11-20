import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Heart,
  Layers3,
  Play,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { external } from "../../lib/bridge";
import { useStore, launch, guarded } from "../../store";
import { AccountAvatar } from "../account/AccountAvatar";

const accountLabels = {
  offline: "离线账号",
  microsoft: "Microsoft 正版",
  external: "外置认证",
};

export function Home({ onOpenDownloads }: { onOpenDownloads: () => void }) {
  const s = useStore();
  const instance = s.instances.find((item) => item.id === s.selected);
  const account = s.accounts.find((item) => item.id === s.accountId);
  const [panel, setPanel] = useState<"account" | "launch" | null>(null);
  const accountArea = useRef<HTMLDivElement>(null);
  const launchArea = useRef<HTMLDivElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const launchTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!panel) return;
    const area = panel === "account" ? accountArea.current : launchArea.current;
    const trigger = panel === "account" ? accountTrigger.current : launchTrigger.current;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !area?.contains(event.target)) setPanel(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPanel(null);
      trigger?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  function chooseLaunchAction(action: () => void) {
    setPanel(null);
    launchTrigger.current?.focus({ preventScroll: true });
    action();
  }

  return (
    <div className="home-layout">
      <h1 className="sr-only">启动</h1>
      <div className="home-dock">
        <div className="home-account-area" ref={accountArea}>
          <button
            ref={accountTrigger}
            className="home-account-trigger"
            aria-label={account ? "当前账号 " + account.name : "玩家账号"}
            title={account?.name ?? "玩家账号"}
            aria-expanded={panel === "account"}
            aria-controls={panel === "account" ? "home-account-popover" : undefined}
            onClick={() => setPanel(panel === "account" ? null : "account")}
          >
            <AccountAvatar account={account} />
          </button>
          {panel === "account" && (
            <section className="home-popover home-account-popover" id="home-account-popover" aria-label="玩家账号" data-fixed-ink>
              <div className="home-account-summary">
                <AccountAvatar account={account} />
                <div>
                  <b>{account?.name ?? "添加账号"}</b>
                  <small>{account ? accountLabels[account.kind] : "Microsoft / 离线 / 外置认证"}</small>
                </div>
              </div>
              <button className="home-menu-row" onClick={() => s.setPage("account")}>
                <UserRound size={16} />
                <b>{account ? "管理账号与皮肤" : "打开账号页"}</b>
                <ArrowUpRight size={14} />
              </button>
              <button className="home-menu-row" onClick={() => guarded(() => external("https://afdian.com/a/keke_657"))}>
                <Heart size={16} />
                <b>爱发电</b>
                <ArrowUpRight size={14} />
              </button>
            </section>
          )}
        </div>
        <div className="home-launch-area" ref={launchArea}>
          <div className="home-launch-controls">
            <Button
              className="home-launch-button"
              data-guide="launch"
              primary
              busy={s.busy}
              aria-label={s.busy ? "正在准备…" : "进入游戏"}
              onClick={() => {
                setPanel(null);
                void launch();
              }}
            >
              {!s.busy && <Play size={19} />}
              <span className="home-launch-label">
                <b>{s.busy ? "正在准备…" : "进入游戏"}</b>
                <small>{instance?.name ?? "尚未选择版本"}</small>
              </span>
            </Button>
            <button
              ref={launchTrigger}
              className="home-launch-options"
              data-guide="home-shortcuts"
              aria-label="更多启动选项"
              title="版本选择"
              aria-expanded={panel === "launch"}
              aria-controls={panel === "launch" ? "home-launch-popover" : undefined}
              onClick={() => setPanel(panel === "launch" ? null : "launch")}
            >
              <ChevronDown size={20} />
            </button>
          </div>
          {panel === "launch" && (
            <section className="home-popover home-launch-popover" id="home-launch-popover" aria-label="启动选项" data-fixed-ink>
              <button
                className="home-menu-row"
                aria-haspopup="dialog"
                onClick={() => chooseLaunchAction(() => s.show("versions"))}
              >
                <Layers3 size={17} />
                <span>
                  <b>版本选择</b>
                  <small>{instance ? instance.version + " · " + instance.loader + " · " + instance.settings.memory + " MB" : "选择或安装版本"}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
