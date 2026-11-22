import {
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  Heart,
  Layers3,
  Play,
  UserRound,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { external } from "../../lib/bridge";
import { useStore, launch, guarded } from "../../store";
import { AccountAvatar } from "../account/AccountAvatar";
const accountLabels = {
  offline: "离线账号",
  microsoft: "Microsoft 正版",
  external: "外置认证",
};
export function Home() {
  const s = useStore();
  const instance = s.instances.find((item) => item.id === s.selected);
  const account = s.accounts.find((item) => item.id === s.accountId);
  const [panel, setPanel] = useState(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const accountArea = useRef(null);
  const launchArea = useRef(null);
  const accountTrigger = useRef(null);
  const launchTrigger = useRef(null);
  const switchTrigger = useRef(null);
  const accountList = useRef(null);
  useLayoutEffect(() => {
    if (accountList.current) accountList.current.inert = !accountsOpen;
  }, [accountsOpen, panel]);
  useEffect(() => {
    if (panel !== "account") setAccountsOpen(false);
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const area = panel === "account" ? accountArea.current : launchArea.current;
    const trigger =
      panel === "account" ? accountTrigger.current : launchTrigger.current;
    function closeOutside(event) {
      if (event.target instanceof Node && !area?.contains(event.target))
        setPanel(null);
    }
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      if (panel === "account" && accountsOpen) {
        setAccountsOpen(false);
        switchTrigger.current?.focus({ preventScroll: true });
        return;
      }
      setPanel(null);
      trigger?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel, accountsOpen]);
  function chooseLaunchAction(action) {
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
            aria-controls={
              panel === "account" ? "home-account-popover" : undefined
            }
            onClick={() => setPanel(panel === "account" ? null : "account")}
          >
            <AccountAvatar account={account} />
          </button>
          {panel === "account" && (
            <section
              className="home-popover home-account-popover"
              id="home-account-popover"
              aria-label="玩家账号"
            >
              <div className="home-account-summary">
                <AccountAvatar account={account} />
                <div>
                  <b>{account?.name ?? "添加账号"}</b>
                  {account && <small>{accountLabels[account.kind]}</small>}
                </div>
              </div>
              {s.accounts.length > 1 && (
                <div className="home-account-switcher" data-open={accountsOpen}>
                  <button
                    ref={switchTrigger}
                    className="home-account-switch-button"
                    aria-expanded={accountsOpen}
                    aria-controls="home-account-choices"
                    onClick={() => setAccountsOpen(!accountsOpen)}
                  >
                    <ArrowLeftRight size={14} />
                    <span>切换账号</span>
                    <ChevronDown size={14} />
                  </button>
                  <div className="home-account-reveal">
                    <div
                      ref={accountList}
                      id="home-account-choices"
                      className="home-account-choices"
                      role="group"
                      aria-label="选择账号"
                    >
                      {s.accounts.map((item) => (
                        <button
                          key={item.id}
                          className="home-menu-row home-account-choice"
                          aria-current={
                            item.id === account?.id ? "true" : undefined
                          }
                          onClick={() => {
                            s.selectAccount(item.id);
                            setAccountsOpen(false);
                            switchTrigger.current?.focus({
                              preventScroll: true,
                            });
                          }}
                        >
                          <AccountAvatar account={item} />
                          <span>
                            <b>{item.name}</b>
                            <small>{accountLabels[item.kind]}</small>
                          </span>
                          {item.id === account?.id && (
                            <Check size={15} aria-label="当前账号" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <button
                className="home-menu-row"
                onClick={() => s.setPage("account")}
              >
                <UserRound size={16} />
                <b>{account ? "管理账号与皮肤" : "打开账号页"}</b>
                <ArrowUpRight size={14} />
              </button>
              <button
                className="home-menu-row"
                onClick={() =>
                  guarded(() => external("https://afdian.com/a/keke_657"))
                }
              >
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
              title="版本选择与快捷入口"
              aria-expanded={panel === "launch"}
              aria-controls={
                panel === "launch" ? "home-launch-popover" : undefined
              }
              onClick={() => setPanel(panel === "launch" ? null : "launch")}
            >
              <ChevronDown size={20} />
            </button>
          </div>
          {panel === "launch" && (
            <section
              className="home-popover home-launch-popover"
              id="home-launch-popover"
              aria-label="启动选项"
            >
              <button
                className="home-menu-row"
                aria-haspopup="dialog"
                onClick={() => chooseLaunchAction(() => s.show("versions"))}
              >
                <Layers3 size={17} />
                <span>
                  <b>版本选择</b>
                  <small>
                    {instance
                      ? instance.version +
                        " · " +
                        instance.loader +
                        " · " +
                        instance.settings.memory +
                        " MB"
                      : "选择或安装版本"}
                  </small>
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
