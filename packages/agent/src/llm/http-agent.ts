import Agent from "agentkeepalive";

/** LLM requests can be slow (tools, long streams). Default keep-alive socket timeout is ~8s. */
const LLM_SOCKET_TIMEOUT_MS = 600_000;

const httpAgent = new Agent({
  keepAlive: true,
  timeout: LLM_SOCKET_TIMEOUT_MS,
  freeSocketTimeout: 60_000,
});

const httpsAgent = new Agent.HttpsAgent({
  keepAlive: true,
  timeout: LLM_SOCKET_TIMEOUT_MS,
  freeSocketTimeout: 60_000,
});

export const LLM_HTTP_TIMEOUT_MS = LLM_SOCKET_TIMEOUT_MS;

export function httpAgentForUrl(url: string | undefined): Agent | Agent.HttpsAgent {
  if (url?.startsWith("http://")) return httpAgent;
  return httpsAgent;
}
