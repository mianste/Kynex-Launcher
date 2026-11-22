import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, FileText, RefreshCw } from "lucide-react";
import { Button, Modal, ProgressBar } from "../../components/ui";
import { api, desktop } from "../../lib/bridge";
import {
  RELEASE,
  RELEASE_SEEN_KEY,
  releaseVersionLabel,
} from "../../lib/release";
import { useStore } from "../../store";
import { Onboarding, GUIDE_KEY } from "../assistant/Onboarding";
export function ReleaseNotices({ ready }) {
  const [guide, setGuide] = useState(false);
  const [guidePage, setGuidePage] = useState("home");
  const [guideSection, setGuideSection] = useState();
  const [log, setLog] = useState(false);
  const [update, setUpdate] = useState(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({
    stage: "downloading",
    downloaded: 0,
    total: 0,
  });
  const started = useRef(false);
  const inFlight = useRef(false);
  const installInFlight = useRef(false);
  const autoStarted = useRef("");
  const promptKey = `kynex-update-prompted-${RELEASE.channel}`;
  const modal = useStore((state) => state.modal);
  const automatic = useStore((state) => state.settings.updateMode === "automatic");
  const startupCheck = useStore((state) => state.settings.checkUpdatesOnStartup !== false);
  const busy = useStore((state) => state.busy || state.directoryBusy ||
    Object.values(state.tasks).some((task) => !task.finished && !task.error));
  const check = useCallback(
    async (manual = false) => {
      if (!desktop) {
        if (manual) useStore.getState().notify("请在桌面版检查更新");
        return;
      }
      if (inFlight.current || installInFlight.current) return;
      inFlight.current = true;
      setChecking(true);
      try {
        const result = await api("check_update");
        if (result.status === "available" && result.update) {
          let seen = [];
          try {
            const raw = JSON.parse(localStorage.getItem(promptKey) || "[]");
            if (Array.isArray(raw)) seen = raw;
          } catch {}
          const auto = useStore.getState().settings.updateMode === "automatic";
          if (auto || manual || !seen.includes(result.update.version)) {
            autoStarted.current = auto && result.previousFailure ? result.update.version : "";
            setUpdate(result.update);
            setError(auto && result.previousFailure ? "上次静默安装未完成，请重试或切换为手动安装。" : "");
          }
        } else {
          setUpdate(null);
          if (manual) useStore.getState().notify(
            result.status === "unconfigured" ? "更新源尚未配置" : "当前已经是最新版本",
          );
        }
      } catch {
        if (manual) useStore.getState().notify("检查更新失败，请稍后重试");
      } finally {
        setChecking(false);
        inFlight.current = false;
      }
    },
    [promptKey],
  );
  useEffect(() => {
    if (!ready || !desktop || started.current) return;
    started.current = true;
    if (localStorage.getItem(RELEASE_SEEN_KEY) !== RELEASE.version) setLog(true);
  }, [ready]);
  useEffect(() => {
    if (!ready || !desktop || (!automatic && !startupCheck)) return;
    void check();
    if (!automatic) return;
    const timer = window.setInterval(() => void check(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready, automatic, startupCheck, check]);
  useEffect(() => {
    const openLog = () => setLog(true);
    const openGuide = (e) => {
      setGuidePage(e.detail?.page || "home");
      setGuideSection(e.detail?.section);
      setGuide(true);
    };
    window.addEventListener("kynex-open-guide", openGuide);
    const manualCheck = () => {
      void check(true);
    };
    window.addEventListener("kynex-open-changelog", openLog);
    window.addEventListener("kynex-check-update", manualCheck);
    return () => {
      window.removeEventListener("kynex-open-guide", openGuide);
      window.removeEventListener("kynex-open-changelog", openLog);
      window.removeEventListener("kynex-check-update", manualCheck);
    };
  }, [check]);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    let stop;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const off = await listen("kynex-update-progress", (event) =>
        setProgress(event.payload),
      );
      if (live) stop = off;
      else off();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (log && !modal) localStorage.setItem(RELEASE_SEEN_KEY, RELEASE.version);
  }, [log, modal]);
  const closeLog = () => {
    localStorage.setItem(RELEASE_SEEN_KEY, RELEASE.version);
    setLog(false);
    setGuidePage("home");
    setGuideSection(undefined);
    // The tour takes priority even while an update check is pending.
    if (localStorage.getItem(GUIDE_KEY) !== "done") setGuide(true);
  };
  const install = useCallback(async (silent) => {
    if (installInFlight.current || inFlight.current) return;
    installInFlight.current = true;
    setInstalling(true);
    setProgress({ stage: "downloading", downloaded: 0, total: 0 });
    setError("");
    try {
      await api("install_update", { silent });
    } catch (reason) {
      const message = String(reason).replace(/^Error: /, "");
      setError(message || "更新未完成，请稍后重试");
      if (silent) useStore.getState().notify(message || "自动更新失败，请稍后重试");
      installInFlight.current = false;
      setInstalling(false);
    }
  }, []);
  useEffect(() => {
    if (ready && automatic && update && !busy && !checking && !installing &&
        autoStarted.current !== update.version) {
      autoStarted.current = update.version;
      void install(true);
    }
  }, [ready, automatic, update, busy, checking, installing, install]);
  useEffect(() => {
    if (!update || automatic || log || guide || modal || localStorage.getItem(GUIDE_KEY) !== "done") return;
    let seen = [];
    try {
      const value = JSON.parse(localStorage.getItem(promptKey) || "[]");
      if (Array.isArray(value)) seen = value;
    } catch {}
    if (!seen.includes(update.version)) localStorage.setItem(promptKey, JSON.stringify([...seen, update.version]));
  }, [update, automatic, log, guide, modal, promptKey]);
  useEffect(() => {
    if (!ready || log || modal || !started.current) return;
    // Don't pre-empt a changelog scheduled by the startup effect.
    if (localStorage.getItem(RELEASE_SEEN_KEY) !== RELEASE.version) return;
    if (localStorage.getItem(GUIDE_KEY) !== "done") setGuide(true);
  }, [ready, log, update, checking, modal]);
  const showUpdate = update && (automatic ? installing || !!error : !modal && !log && !guide);
  if (modal && !showUpdate) return null;
  return (
    <>
      {!showUpdate && guide && !log && (
        <Onboarding
          initialPage={guidePage}
          initialSection={guideSection}
          close={() => setGuide(false)}
        />
      )}
      {checking && (
        <span className="release-checking" role="status">
          <RefreshCw size={13} className="spin" />
          正在检查更新
        </span>
      )}
      {!showUpdate && log && (
        <Modal
          title="更新日志"
          className="changelog-modal"
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
            </div>
          </div>
          <ul className="release-changes">
            {RELEASE.changes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Modal>
      )}
      {showUpdate && (
        <Modal
          title={automatic ? "启动器自动更新" : "发现新版本"}
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
                onClick={() => void install(automatic)}
              >
                <ArrowDownToLine size={15} />
                {installing ? "正在更新" : automatic ? "重试" : "立即更新"}
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
                  : progress.stage === "waiting"
                    ? "更新已校验，等待当前任务完成…"
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
