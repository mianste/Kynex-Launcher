import { useEffect, useRef, useState } from "react";
import { Mic, ImagePlus, X } from "lucide-react";
import { api, desktop } from "../../lib/bridge";
import { Button } from "../../components/ui";
export type Screenshot = { id: string; name: string; data: string };
export const MAX_MEDIA = 10 * 1024 * 1024;
export function validateScreenshot(file: Pick<File, "size" | "type">) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("仅支持 PNG、JPEG 或 WebP 截图。");
  if (!file.size || file.size > MAX_MEDIA)
    throw Error("单张截图不能为空或超过 10 MB。");
}
export function fittedSize(width: number, height: number) {
  const scale = Math.min(1, 2048 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
export async function prepareScreenshot(file: File): Promise<Screenshot> {
  validateScreenshot(file);
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    Object.assign(canvas, fittedSize(bitmap.width, bitmap.height));
    const context = canvas.getContext("2d");
    if (!context) throw Error("无法处理截图，请改为粘贴报错文字。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/png");
    if (data.length > (MAX_MEDIA * 4) / 3 + 40)
      throw Error("截图转换后超过 10 MB，请裁剪后重试。");
    return { id: crypto.randomUUID(), name: "截图", data };
  } finally {
    bitmap.close();
  }
}
export function ScreenshotPreviews({
  images,
  remove,
}: {
  images: Screenshot[];
  remove: (id: string) => void;
}) {
  return (
    <div className="assistant-images" aria-label="本次截图附件">
      {images.map((image) => (
        <figure key={image.id}>
          <img src={image.data} alt="待发送的 Minecraft 截图" />
          <button
            type="button"
            aria-label="移除截图"
            onClick={() => remove(image.id)}
          >
            <X size={14} />
          </button>
        </figure>
      ))}
    </div>
  );
}
export function ScreenshotButton({
  disabled,
  add,
}: {
  disabled: boolean;
  add: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={15} />
        添加截图
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        aria-label="选择截图"
        onChange={(e) => {
          add(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
    </>
  );
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function VoiceInput({
  disabled,
  onText,
  onError,
}: {
  disabled: boolean;
  onText: (text: string) => void;
  onError: (error: string) => void;
}) {
  const [enabled, Enabled] = useState(false),
    [recording, Recording] = useState(false),
    [busy, Busy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(),
    alive = useRef(true),
    starting = useRef(false),
    held = useRef(false),
    discard = useRef(false);
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };
  useEffect(() => {
    alive.current = true;
    const load = () => {
      if (desktop)
        void api<{ configured: boolean }>("ai_voice_config")
          .then((v) => {
            if (alive.current) Enabled(v.configured);
          })
          .catch(() => {});
    };
    load();
    window.addEventListener("kynex-voice-config", load);
    return () => {
      alive.current = false;
      discard.current = true;
      held.current = false;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("kynex-voice-config", load);
    };
  }, []);
  const stop = () => {
    held.current = false;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  async function start() {
    if (
      disabled ||
      busy ||
      starting.current ||
      recorder.current?.state === "recording"
    )
      return;
    held.current = true;
    starting.current = true;
    discard.current = false;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error("当前环境无法使用麦克风，请直接输入文字。");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || !held.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) throw Error("当前 WebView 不支持录音格式，请直接输入文字。");
      const rec = new MediaRecorder(media, { mimeType: mime });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0;
      const began = Date.now();
      rec.ondataavailable = (e) => {
        size += e.data.size;
        if (size > MAX_MEDIA) {
          discard.current = true;
          stop();
          callbacks.current.onError("录音超过 10 MB，请分段重试。");
        } else chunks.push(e.data);
      };
      rec.onerror = () => {
        discard.current = true;
        stop();
        callbacks.current.onError("录音失败，请检查麦克风权限后重试。");
      };
      rec.onstop = () => {
        clearTimeout(timer.current);
        media.getTracks().forEach((t) => t.stop());
        stream.current = null;
        recorder.current = null;
        if (!alive.current) return;
        Recording(false);
        if (discard.current) return;
        const audio = new Blob(chunks, { type: mime.split(";")[0] });
        if (!audio.size) return;
        Busy(true);
        void audio
          .arrayBuffer()
          .then((buffer) =>
            api<{ text: string }>("voice_transcribe", {
              audio: base64(new Uint8Array(buffer)),
              mime: audio.type,
              durationMs: Math.max(1, Math.min(60000, Date.now() - began)),
            }),
          )
          .then((v) => {
            if (alive.current) callbacks.current.onText(v.text);
          })
          .catch(() => {
            if (alive.current)
              callbacks.current.onError(
                "没能把语音转成文字。请检查 AI 设置里的语音地址、模型和密钥。",
              );
          })
          .finally(() => {
            if (alive.current) Busy(false);
          });
      };
      rec.start(250);
      Recording(true);
      timer.current = setTimeout(stop, 60000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (alive.current)
        callbacks.current.onError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "麦克风权限被拒绝，请在系统隐私设置中允许启动器使用麦克风。"
            : String(e).replace(/^Error: /, ""),
        );
    } finally {
      starting.current = false;
    }
  }
  if (!enabled) return null;
  return (
    <Button
      type="button"
      disabled={disabled || busy}
      aria-label="按住说话"
      aria-pressed={recording}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        void start();
      }}
      onPointerUp={stop}
      onPointerCancel={() => {
        discard.current = true;
        stop();
      }}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          void start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stop();
        }
      }}
      onBlur={stop}
    >
      <Mic size={15} />
      {recording ? "录音中 · 松开转写" : busy ? "正在把语音转成文字…" : "按住说话"}
    </Button>
  );
}
