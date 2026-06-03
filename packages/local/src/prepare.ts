import type { M3Config } from "@m3/config";
import { parseModelRef } from "@m3/config";
import { LOCAL_PROVIDER_ID } from "./constants.js";
import { ensureLocalInferenceServer } from "./llama-server.js";
import { isLocalModelRef } from "./run.js";
import { loadLocalState, saveLocalState } from "./state.js";

export async function prepareInferenceBackend(
  config: M3Config,
  onLog?: (line: string) => void,
): Promise<void> {
  const ref = config.agent.model ?? config.models.default;
  if (!isLocalModelRef(ref)) {
    const { providerId } = parseModelRef(ref);
    if (providerId !== LOCAL_PROVIDER_ID) return;
  }
  const state = loadLocalState();
  if (state && config.local?.ctxSize && state.ctxSize !== config.local.ctxSize) {
    state.ctxSize = config.local.ctxSize;
    saveLocalState(state);
    onLog?.(`Using ctx-size=${state.ctxSize} from m3.json (restart llama-server if it was already running)`);
  }
  await ensureLocalInferenceServer(onLog);
}
