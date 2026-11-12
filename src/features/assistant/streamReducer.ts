import type { Message, Usage } from "./sessionStore";
export type StreamEvent = { requestId: string; delta?: string; done?: boolean; cancelled?: boolean; reply?: string; usage?: Usage | null; elapsedMs?: number; model?: string; error?: string };
export function streamReducer(messages: Message[], event: StreamEvent): Message[] {
  return messages.map(message => {
    if (message.requestId !== event.requestId || message.status !== "streaming") return message;
    if (event.cancelled) return { ...message, status: "cancelled" };
    if (event.error) return { ...message, status: "error", error: event.error };
    if (event.done) return { ...message, status: "done", content: event.reply ?? message.content, usage: event.usage, elapsedMs: event.elapsedMs, model: event.model };
    return event.delta ? { ...message, content: message.content + event.delta } : message;
  });
}
