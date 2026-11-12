import { useEffect, useState } from "react";
import { Button, Input, Row } from "../../components/ui";
import { api, desktop } from "../../lib/bridge";
export function VoiceSettings() {
  const [endpoint, Endpoint] = useState(""),
    [model, Model] = useState(""),
    [key, Key] = useState(""),
    [configured, C] = useState(false),
    [busy, B] = useState(false),
    [status, S] = useState("");
  useEffect(() => {
    if (desktop)
      void api<{ endpoint: string; model: string; configured: boolean }>(
        "ai_voice_config",
      )
        .then((v) => {
          Endpoint(v.endpoint || "");
          Model(v.model || "");
          C(v.configured);
        })
        .catch(() => S("无法读取语音配置，请重试。"));
  }, []);
  async function save(op: string) {
    B(true);
    S("");
    try {
      const v = await api<{ configured: boolean }>("ai_voice_config", {
        op,
        endpoint,
        model,
        key,
      });
      C(v.configured);
      Key("");
      if (op === "clear") {
        Endpoint("");
        Model("");
      }
      S(
        op === "clear"
          ? "已移除语音配置。"
          : "语音设置已保存。松开按钮后，说的话会变成输入框里的文字。",
      );
      window.dispatchEvent(new Event("kynex-voice-config"));
    } catch (e) {
      S(String(e).replace(/^Error: /, ""));
    } finally {
      B(false);
    }
  }
  return (
    <section className="assistant-voice-settings">
      <h3>语音输入</h3>
      <Row title="语音接口地址">
        <Input
          aria-label="语音接口地址"
          value={endpoint}
          disabled={busy}
          onChange={(e) => Endpoint(e.target.value)}
          placeholder="https://服务地址/v1/audio/transcriptions"
        />
      </Row>
      <Row title="语音模型">
        <Input
          aria-label="语音模型"
          value={model}
          disabled={busy}
          onChange={(e) => Model(e.target.value)}
          placeholder="服务提供的转写模型名称"
        />
      </Row>
      <Row
        title="语音 API Key"
        hint="换服务地址时，请重新填写密钥。"
      >
        <Input
          aria-label="语音 API Key"
          type="password"
          autoComplete="off"
          value={key}
          disabled={busy}
          onChange={(e) => Key(e.target.value)}
          placeholder={
            configured ? "已经填过，留空可继续用" : "本机服务不需要密钥时可留空"
          }
        />
      </Row>
      <div className="agent-actions">
        <Button
          type="button"
          primary
          busy={busy}
          disabled={!desktop || !endpoint.trim() || !model.trim()}
          onClick={() => void save("save")}
        >
          保存语音配置
        </Button>
        <Button
          type="button"
          disabled={busy || !configured}
          onClick={() => void save("clear")}
        >
          移除语音配置
        </Button>
      </div>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
