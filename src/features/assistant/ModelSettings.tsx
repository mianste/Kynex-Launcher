import { useEffect, useRef, useState } from "react";
import { api, desktop } from "../../lib/bridge";
import { Button, ChoiceSelect, Input, Row, Switch } from "../../components/ui";
import {
  Activity,
  CheckCircle2,
  XCircle,
  PlugZap,
  Save,
  Info,
  KeyRound,
  Trash2,
} from "lucide-react";
import { SettingsAction } from "../settings/SettingsAction";
import { VoiceSettings } from "./VoiceSettings";
type Provider = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  configured?: boolean;
  supportsVision?: boolean;
};
type Config = { active: string; items: Provider[] };
const empty = { id: "", name: "", endpoint: "", model: "" };
function isLocal(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export function ModelSettings() {
  const [config, C] = useState<Config>({ active: "deepseek", items: [] });
  const [form, F] = useState<Provider>(empty);
  const [key, K] = useState("");
  const [busy, B] = useState(false);
  const [operation, Operation] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const [status, S] = useState("");
  const [test, Test] = useState<{
    ok: boolean;
    message: string;
    model?: string;
    reply?: string;
    elapsedMs?: number;
  } | null>(null);
  const [automatic, A] = useState(true);
  const revision = useRef(0);
  useEffect(() => {
    if (test) resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [test]);
  function edit(p: Provider) {
    revision.current++;
    F(p);
    K("");
    S("");
    Test(null);
  }
  async function load() {
    const c = await api<Config>("ai_models");
    C(c);
    edit(c.items.find((p) => p.id === c.active) ?? c.items[0] ?? empty);
  }
  useEffect(() => {
    if (desktop) void load().catch((e) => S(String(e)));
    if (desktop)
      void api<{ automatic: boolean }>("ai_options")
        .then((v) => A(v.automatic))
        .catch((e) => S(String(e)));
  }, []);
  async function act(op: string) {
    if (busy) return;
    B(true);
    Operation(op);
    S("");
    if (op === "test") Test(null);
    const token = revision.current;
    try {
      if (op === "test") {
        const start = performance.now();
        const result = await api<{
          ok: boolean;
          model: string;
          reply: string;
          elapsedMs: number;
        }>("ai_test_connection", { ...form, key });
        if (token === revision.current) {
          Test({
            ok: true,
            message: "模型已回复，可以保存使用。",
            model: result.model || form.model,
            reply: result.reply,
            elapsedMs:
              result.elapsedMs ?? Math.round(performance.now() - start),
          });
        }
      } else {
        await api("ai_models", { ...form, key, op });
        await load();
        S(op === "save" ? "已保存，助手现在会用这个模型。" : "设置已更新。");
      }
    } catch (e) {
      if (token === revision.current) {
        if (op === "test")
          Test({ ok: false, message: String(e).replace(/^Error: /, "") });
        else S(String(e));
      }
    } finally {
      B(false);
      Operation("");
    }
  }
  return (
    <section className="model-settings">
      <h3>AI 助手 · 模型与连接</h3>
      <Row title="模型配置">
        <ChoiceSelect
          aria-label="模型配置"
          className="model-provider-select"
          disabled={busy}
          value={form.id}
          onValueChange={(id) =>
            edit(config.items.find((p) => p.id === id) ?? empty)
          }
          options={[
            ...config.items.map((p) => ({
              value: p.id,
              label: p.name,
              hint: [
                p.model,
                p.id === config.active && "正在使用",
                !p.configured && !isLocal(p.endpoint) && "还没填密钥",
              ]
                .filter(Boolean)
                .join(" · "),
            })),
            { value: "", label: "添加自定义模型" },
          ]}
        />
      </Row>
      {(
        [
          ["name", "服务名称"],
          ["endpoint", "API 地址"],
          ["model", "模型名称"],
        ] as const
      ).map(([field, label]) => (
        <Row key={field} title={label}>
          <Input
            aria-label={label}
            disabled={busy || (form.id === "deepseek" && field === "endpoint")}
            value={form[field]}
            placeholder={
              field === "endpoint"
                ? "https://服务地址/v1/chat/completions"
                : label
            }
            onChange={(e) => {
              revision.current++;
              F({ ...form, [field]: e.target.value });
              S("");
              Test(null);
            }}
          />
        </Row>
      ))}
      <Row
        title="API Key"
        hint="留空会保留原来的密钥。换服务地址时，请重新填写。"
      >
        <Input
          type="password"
          aria-label="AI API Key"
          autoComplete="off"
          disabled={busy}
          value={key}
          placeholder={
            form.configured
              ? "已经填过，留空可继续用"
              : isLocal(form.endpoint)
                ? "本机服务不需要密钥时可留空"
                : "请自行填写 API Key"
          }
          onChange={(e) => {
            revision.current++;
            K(e.target.value);
            S("");
            Test(null);
          }}
        />
      </Row>
      <div className="model-actions-panel">
        <label className="model-vision-option">
          <input
            type="checkbox"
            checked={!!form.supportsVision}
            disabled={busy}
            onChange={(e) => {
              revision.current++;
              F({ ...form, supportsVision: e.target.checked });
              Test(null);
            }}
          />
          这个模型能看图片
        </label>
        <div className="model-primary-row">
          <div className="model-action-copy">
            <h4>连接与使用</h4>
            <p>可以先测试，再保存。</p>
          </div>
          <div className="model-primary-buttons">
            <Button
              busy={operation === "test"}
              disabled={!desktop || busy}
              onClick={() => void act("test")}
            >
              <PlugZap size={15} aria-hidden="true" />
              测试连接
            </Button>
            <Button
              primary
              busy={operation === "save"}
              disabled={!desktop || busy}
              onClick={() => void act("save")}
            >
              <Save size={15} aria-hidden="true" />
              保存并使用
            </Button>
          </div>
        </div>
        {form.id && (
          <div className="model-management-row">
            <span className="model-selection-state">
              {form.id === config.active ? "正在使用" : "还没启用"}
            </span>
            <div className="model-management-buttons">
              <Button
                disabled={!desktop || busy || form.id === config.active}
                onClick={() => void act("select")}
              >
                切换到此模型
              </Button>
              <Button
                disabled={!desktop || busy}
                onClick={() => void act("clear_key")}
              >
                <KeyRound size={14} aria-hidden="true" />
                清除密钥
              </Button>
              {form.id !== "deepseek" && (
                <Button
                  disabled={!desktop || busy}
                  onClick={() => void act("delete")}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  删除模型
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="model-connection-hint">
          <Info size={15} aria-hidden="true" />
          <p>
            测试会发一条消息给模型。点「保存并使用」才会保存。
            <br />
            请填写以 <code>/chat/completions</code> 结尾的完整地址。
          </p>
        </div>
      </div>
      {test && (
        <div
          ref={resultRef}
          className={`ai-connection-result ${test.ok ? "success" : "failure"}`}
          role={test.ok ? "status" : "alert"}
        >
          {test.ok ? <CheckCircle2 size={26} /> : <XCircle size={26} />}
          <div>
            <b>{test.ok ? "调用成功" : "调用失败"}</b>
            <p>{test.message}</p>
            {test.ok && (
              <>
                <p>
                  模型：{test.model} · 耗时：{test.elapsedMs} ms
                </p>
                {test.reply && <p>模型返回：{test.reply}</p>}
              </>
            )}
          </div>
        </div>
      )}
      {(busy || status) && (
        <p role="status">{busy ? "正在等模型回复…" : status}</p>
      )}
      <SettingsAction
        icon={<Activity size={18} />}
        title="自动分析闪退"
        description="游戏闪退时，助手会先隐藏日志里的敏感信息，再帮你找原因。"
      >
        <Switch
          label="自动分析游戏报错"
          on={automatic}
          change={() => {
            void api("ai_options", { automatic: !automatic })
              .then(() => A(!automatic))
              .catch((e) => S(String(e)));
          }}
        />
      </SettingsAction>
      <VoiceSettings />
    </section>
  );
}
