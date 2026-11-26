import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, FileText, RefreshCw, X } from "lucide-react";
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
  const [progressHidden, setProgressHidden] = useState(false);
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
  const panel = useRef(null);
  const panelDrag = useRef(null);
  const [panelAt, setPanelAt] = useState(null);
  const promptKey = `kynex-update-prompted-${RELEASE.channel}`;
  const modal = useStore((state) => state.modal);
  const automatic = useStore((state) => state.settings.updateMode === "automatic");
  const startupCheck = useStore((state) => state.settings.checkUpdatesOnStartup !== false);
  const check = useCallback(
    async (manual = false) => {
      if (!desktop) {
        if (manual) useStore.getState().notify("请在桌面版检查更新");
        return;
      }
      if (installInFlight.current) {
        if (manual) setProgressHidden(false);
        return;
      }
      if (inFlight.current) return;
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
            setError(result.previousFailure ? "上次安装未完成。可以重试，或从发布页下载完整安装器。" : "");
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
  const install = useCallback(async () => {
    if (installInFlight.current || inFlight.current) return;
    installInFlight.current = true;
    setInstalling(true);
    setProgressHidden(false);
    setProgress({ stage: "downloading", downloaded: 0, total: 0 });
    setError("");
    try {
      await api("install_update", { silent: true });
    } catch (reason) {
      const detail = String(reason ?? "").replace(/^Error: /, "").trim();
      const message = detail ? `更新未完成：${detail}` : "更新未完成，请稍后重试";
      setError(message);
      useStore.getState().notify(message);
      installInFlight.current = false;
      setInstalling(false);
    }
  }, []);
  useEffect(() => {
    if (!ready || !automatic || !update || checking || installing || modal || log || guide) return;
    if (autoStarted.current === update.version) return;
    autoStarted.current = update.version;
    void install();
  }, [ready, automatic, update, checking, installing, modal, log, guide, install]);
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
  const showUpdate = update && !installing && !modal && !log && !guide && (!automatic || !!error);
  const percent = progress.total > 0
    ? Math.min(100, Math.round(100 * progress.downloaded / progress.total))
    : 0;
  const statusText = progress.stage === "installing"
    ? "正在安装，完成后会重新打开启动器"
    : progress.stage === "waiting"
      ? "下载完成，等待当前任务结束"
      : progress.stage === "verifying"
        ? "正在校验更新包"
        : progress.total > 0
          ? `正在下载 ${percent}%`
          : progress.downloaded > 0
            ? `已下载 ${(progress.downloaded / 1048576).toFixed(1)} MB`
            : "正在连接下载源";
  const startPanelDrag = (event) => {
    if (event.button !== 0 || event.target.closest("button") || !panel.current) return;
    const box = panel.current.getBoundingClientRect();
    panelDrag.current = { x: event.clientX - box.left, y: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePanel = (event) => {
    const drag = panelDrag.current;
    const node = panel.current;
    if (!drag || !node) return;
    const maxX = Math.max(8, window.innerWidth - node.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - node.offsetHeight - 8);
    setPanelAt({
      x: Math.min(Math.max(8, event.clientX - drag.x), maxX),
      y: Math.min(Math.max(8, event.clientY - drag.y), maxY),
    });
  };
  const endPanelDrag = (event) => {
    if (!panelDrag.current) return;
    panelDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <>
      {installing && update && (progressHidden ? (
        <button className="release-update-chip" type="button" data-fixed-ink onClick={() => setProgressHidden(false)}>
          <ArrowDownToLine size={15} aria-hidden="true" />
          更新中{percent > 0 ? ` ${percent}%` : ""}
          <span className="release-update-chip-action">查看进度</span>
        </button>
      ) : (
        <aside
          ref={panel}
          className="release-update-panel"
          data-fixed-ink
          style={panelAt ? { left: panelAt.x, top: panelAt.y, right: "auto", bottom: "auto" } : undefined}
          aria-label="启动器更新进度"
        >
          <header
            className="release-update-header"
            onPointerDown={startPanelDrag}
            onPointerMove={movePanel}
            onPointerUp={endPanelDrag}
            onPointerCancel={endPanelDrag}
          >
            <strong title={`正在更新至 ${releaseVersionLabel(update.version)}`}>
              正在更新至 {releaseVersionLabel(update.version)}
            </strong>
            <button
              className="release-update-hide"
              type="button"
              title="隐藏进度窗口，更新会在后台继续"
              aria-label="隐藏更新进度"
              onClick={() => setProgressHidden(true)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <div className="release-download">
            <ProgressBar done={progress.downloaded} total={progress.total} />
            <span role="status">{statusText}</span>
          </div>
        </aside>
      ))}
      {!showUpdate && !modal && guide && !log && (
        <Onboarding
          initialPage={guidePage}
          initialSection={guideSection}
          close={() => setGuide(false)}
        />
      )}
      {checking && (
        <span className="release-checking" role="status" data-fixed-ink>
          <RefreshCw size={13} className="spin" />
          正在检查更新
        </span>
      )}
      {!showUpdate && !modal && log && (
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
          onClose={() => setUpdate(null)}
          footer={
            <>
              <Button onClick={() => setUpdate(null)}>取消</Button>
              <Button primary disabled={checking} onClick={() => void install()}>
                <ArrowDownToLine size={15} />
                {error ? "重试" : "立即更新"}
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
