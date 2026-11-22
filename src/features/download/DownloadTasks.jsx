import {
  Download,
  CheckCircle2,
  CircleAlert,
  RotateCcw,
  X,
} from "lucide-react";
import { Button, Modal, ProgressBar } from "../../components/ui";
import { useStore, guarded } from "../../store";
import { api } from "../../lib/bridge";
export function DownloadTasks({ onClose }) {
  const tasks = useStore((s) => s.tasks);
  const entries = Object.entries(tasks).reverse();
  const active = entries.filter(([, t]) => !t.finished && !t.error).length;
  return (
    <Modal
      wide
      title="下载任务"
      onClose={onClose}
      footer={
        <>
          <span>
            {active ? `${active} 个任务正在运行或排队` : "所有任务已结束"}
          </span>
          <Button
            onClick={() =>
              useStore.setState({
                tasks: Object.fromEntries(
                  entries.filter(([, t]) => !t.finished && !t.error),
                ),
              })
            }
          >
            清除已结束
          </Button>
        </>
      }
    >
      <div className="download-task-list">
        {!entries.length && (
          <div className="empty">
            <Download size={32} />
            <h3>还没有下载任务</h3>
            <p>安装游戏、资源或整合包后，在这里查看进度。</p>
          </div>
        )}
        {entries.map(([id, t]) => {
          const ended = t.finished || !!t.error;
          const completion = t.finished && !t.error ? t.completion : undefined;
          const detail = completion
            ? completion.detail
            : t.error ||
              (ended ? "已完成" : t.detail || `${t.done} / ${t.total}`);
          return (
            <article className="download-task-card" key={id}>
              <div className="download-task-heading">
                {t.error ? (
                  <CircleAlert size={22} />
                ) : ended ? (
                  <CheckCircle2 size={22} />
                ) : (
                  <Download size={22} />
                )}
                <div>
                  <strong>{t.name || "下载任务"}</strong>
                  <small>{completion?.title ?? t.stage}</small>
                </div>
                {!ended && (
                  <Button
                    onClick={() => guarded(() => api("cancel", { taskId: id }))}
                  >
                    <X size={14} />
                    取消
                  </Button>
                )}
              </div>
              {!ended && <ProgressBar done={t.done} total={t.total} />}
              {detail && (
                <p className={t.error ? "download-task-error" : ""}>{detail}</p>
              )}
              {t.error && t.action && t.payload && (
                <Button
                  onClick={() =>
                    guarded(async () => {
                      await api(t.action, t.payload);
                      await useStore.getState().refresh();
                    })
                  }
                >
                  <RotateCcw size={14} />
                  重试
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
