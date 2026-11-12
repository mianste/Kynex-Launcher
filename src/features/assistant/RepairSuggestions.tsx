import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import { api } from "../../lib/bridge";
import { useStore } from "../../store";
import { diagnose } from "../diagnose/logRules";
import type { Instance } from "../../lib/types";
export function RepairSuggestions({ text }: { text: string }) {
  const s = useStore();
  const rules = diagnose(text);
  const instance = s.instances.find((i) => i.id === s.selected);
  const [proposal, P] = useState<{
    instance: Instance;
    directoryId: string;
    kind: "java" | "memory";
  } | null>(null);
  const [memory, M] = useState(6144);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  async function apply() {
    if (!proposal || busy) return;
    B(true);
    E("");
    try {
      const current = useStore.getState();
      const target = current.instances.find(
        (i) => i.id === proposal.instance.id,
      );
      if (current.directoryId !== proposal.directoryId || !target)
        throw new Error("目标实例已变更，请重新生成修复方案");
      if (
        proposal.kind === "memory" &&
        (!Number.isInteger(memory) || memory < 512 || memory > 65536)
      )
        throw new Error("请输入 512–65536 MB 的整数");
      await api("save_instance", {
        directoryId: proposal.directoryId,
        id: target.id,
        settings: {
          ...target.settings,
          ...(proposal.kind === "java" ? { java: "" } : { memory }),
        },
      });
      await s.refresh();
      P(null);
      s.notify("修复设置已保存，请重新启动游戏验证。");
    } catch (e) {
      E(String(e));
    } finally {
      B(false);
    }
  }
  return (
    <>
      {rules.length > 0 && (
        <div className="card">
          <h3>报错线索与辅助修复</h3>
          {rules.map((rule) => (
            <div key={rule.id}>
              <b>{rule.title}</b>
              <p>{rule.advice}</p>
              <small>
                证据：第 {rule.lines[0].number} 行 ·{" "}
                {rule.lines[0].text.slice(0, 180)}
              </small>
              {instance &&
                ((rule.id === "java" && instance.settings.java) ||
                  rule.id === "oom") && (
                  <Button
                    onClick={() => {
                      E("");
                      M(
                        Math.min(
                          65536,
                          Math.max(4096, instance.settings.memory + 1024),
                        ),
                      );
                      P({
                        instance,
                        directoryId: s.directoryId,
                        kind: rule.id === "java" ? "java" : "memory",
                      });
                    }}
                  >
                    预览修复设置
                  </Button>
                )}
            </div>
          ))}
        </div>
      )}
      {proposal && (
        <Modal
          title="确认修复设置"
          onClose={() => {
            if (!busy) P(null);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => P(null)}>
                取消
              </Button>
              <Button primary disabled={busy} onClick={() => void apply()}>
                应用到此实例
              </Button>
            </>
          }
        >
          <p>
            目标：{proposal.instance.name} · {proposal.instance.version} ·{" "}
            {proposal.instance.loader}
          </p>
          {proposal.kind === "java" ? (
            <p>
              将 Java 从「{proposal.instance.settings.java}
              」改为自动匹配。下一次启动时由启动器选择适合游戏版本的 Java。
            </p>
          ) : (
            <>
              <p>
                当前内存：{proposal.instance.settings.memory}{" "}
                MB。请为系统和其他程序预留足够内存，建议至少 2 GB。
              </p>
              <label>
                新的内存（MB）
                <input
                  type="number"
                  aria-label="修复后的内存"
                  min={512}
                  max={65536}
                  value={memory}
                  onChange={(e) => M(Number(e.target.value))}
                />
              </label>
            </>
          )}
          <p>保存后需重新启动游戏验证；日志中的其他冲突仍可能需要处理。</p>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
