import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, FileText, RefreshCw } from "lucide-react";
import { Button, Modal, ProgressBar } from "../../components/ui";
import { api, desktop } from "../../lib/bridge";
import {
  RELEASE,
  RELEASE_SEEN_KEY,
  releaseVersionLabel,
  type AvailableUpdate,
  type UpdateCheck,
  type UpdateProgress,
} from "../../lib/release";
import { useStore } from "../../store";

export function ReleaseNotices({ ready }: { ready: boolean }) {
  const [log, setLog] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<UpdateProgress>({
    stage: "downloading",
    downloaded: 0,
    total: 0,
  });
  const started = useRef(false);
  const modal = useStore((state) => state.modal);
  const check = useCallback(async (manual = false) => {
    if (!desktop) {
      if (manual) useStore.getState().notify("请在桌面版检查更新");
      return;
    }
    setChecking(true);
    try {
      const result = await api<UpdateCheck>("check_update");
      if (result.status === "available" && result.update) {
        setUpdate(result.update);
        setError("");
      } else if (manual)
        useStore
          .getState()
          .notify(
            result.status === "unconfigured"
              ? "更新源尚未配置"
              : "当前已经是最新版本",
          );
    } catch {
      if (manual) useStore.getState().notify("检查更新失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!ready || !desktop || started.current) return;
    started.current = true;
    if (localStorage.getItem(RELEASE_SEEN_KEY) !== RELEASE.version)
      setLog(true);
    void check();
  }, [ready, check]);
  useEffect(() => {
    const openLog = () => setLog(true);
    const manualCheck = () => {
      void check(true);
    };
    window.addEventListener("kynex-open-changelog", openLog);
    window.addEventListener("kynex-check-update", manualCheck);
    return () => {
      window.removeEventListener("kynex-open-changelog", openLog);
      window.removeEventListener("kynex-check-update", manualCheck);
    };
  }, [check]);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const off = await listen<UpdateProgress>(
        "kynex-update-progress",
        (event) => setProgress(event.payload),
      );
      if (live) stop = off;
      else off();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  const closeLog = () => {
    localStorage.setItem(RELEASE_SEEN_KEY, RELEASE.version);
    setLog(false);
  };
  async function install() {
    setInstalling(true);
    setError("");
    try {
      await api("install_update");
    } catch {
      setError("更新未完成，请检查网络后重试");
      setInstalling(false);
    }
  }
  if (modal) return null;
  return (
    <>
      {checking && (
        <span className="release-checking" role="status">
          <RefreshCw size={13} className="spin" />
          正在检查更新
        </span>
      )}
      {log && (
        <Modal
          title="更新日志"
          onClose={closeLog}
          footer={
            <Button primary onClick={closeLog}>
              <Check size={15} />
              开始使用
            </Button>
          }
        >
          <div className="release-notice">
            <div className="release-emblem">
              <FileText size={26} />
            </div>
            <div>
              <span className="release-channel">
                {RELEASE.channel === "beta" ? "开发者预览版" : "正式版"}
              </span>
              <h2>{RELEASE.displayVersion}</h2>
              <p>新旅程，准备就绪。</p>
            </div>
          </div>
          <ul className="release-changes">
            {RELEASE.changes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Modal>
      )}
      {!log && update && (
        <Modal
          title="发现新版本"
          onClose={() => {
            if (!installing) setUpdate(null);
          }}
          footer={
            <>
              <Button disabled={installing} onClick={() => setUpdate(null)}>
                取消
              </Button>
              <Button
                primary
                busy={installing}
                disabled={installing}
                onClick={() => void install()}
              >
                <ArrowDownToLine size={15} />
                {installing ? "正在更新" : "立即更新"}
              </Button>
            </>
          }
        >
          <div className="release-notice">
            <div className="release-emblem">
              <ArrowDownToLine size={26} />
            </div>
            <div>
              <span className="release-channel">{RELEASE.label}</span>
              <h2>{releaseVersionLabel(update.version)}</h2>
              <p>新版本已准备好，更新后继续你的旅程。</p>
            </div>
          </div>
          <div className="release-remote-notes">
            {update.notes || "本次更新包含功能优化和问题修复。"}
          </div>
          {installing && (
            <div className="release-download" role="status">
              <ProgressBar done={progress.downloaded} total={progress.total} />
              <span>
                {progress.stage === "installing"
                  ? "校验完成，正在安装更新…"
                  : progress.stage === "verifying"
                    ? "正在校验更新包…"
                    : progress.total
                      ? `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
                      : "正在连接下载源…"}
              </span>
            </div>
          )}
          {error && (
            <p className="release-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
