import { useStore } from "../store";
let pendingAi = false;
export function openAiSettings() {
  pendingAi = true;
  useStore.getState().setPage("settings");
  window.dispatchEvent(new Event("kynex-open-ai-settings"));
}
export function consumeAiSettings() {
  const requested = pendingAi;
  pendingAi = false;
  return requested;
}
