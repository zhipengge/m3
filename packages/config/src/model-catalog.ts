import type { M3Config } from "./schema.js";
import { parseModelRef } from "./models.js";
import { type M3Secrets } from "./secrets.js";
import { resolveModel } from "./resolve-model.js";

export type ModelListEntry = {
  ref: string;
  providerId: string;
  modelId: string;
  alias?: string;
  api: string;
  localOnly?: boolean;
  hasApiKey: boolean;
  source: "config";
};

function providerHasApiKey(
  providerId: string,
  apiKeyEnv: string | undefined,
  localOnly: boolean | undefined,
  secrets: M3Secrets,
): boolean {
  if (localOnly) return true;
  if (secrets.providers[providerId]?.apiKey) return true;
  if (apiKeyEnv && process.env[apiKeyEnv]) return true;
  if (process.env[`M3_${providerId.toUpperCase()}_API_KEY`]) return true;
  if (providerId === "minimax" && process.env.MINIMAX_API_KEY) return true;
  return false;
}

/** All models declared under models.providers in m3.json. */
export function listConfiguredModels(
  config: M3Config,
  secrets: M3Secrets = { providers: {} },
): ModelListEntry[] {
  const entries: ModelListEntry[] = [];
  for (const [providerId, provider] of Object.entries(config.models.providers)) {
    for (const [modelId, entry] of Object.entries(provider.models)) {
      entries.push({
        ref: `${providerId}/${modelId}`,
        providerId,
        modelId,
        alias: entry.alias,
        api: provider.api,
        localOnly: provider.localOnly,
        hasApiKey: providerHasApiKey(providerId, provider.apiKeyEnv, provider.localOnly, secrets),
        source: "config",
      });
    }
  }
  return entries.sort((a, b) => a.ref.localeCompare(b.ref));
}

export function getActiveModelRef(config: M3Config): string {
  return config.agent.model ?? config.models.default;
}

export function setActiveModel(config: M3Config, ref: string): M3Config {
  parseModelRef(ref);
  return {
    ...config,
    models: {
      ...config.models,
      default: ref,
    },
    agent: {
      ...config.agent,
      model: ref,
    },
  };
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Resolve user input to a full provider/model ref. */
export function resolveModelQuery(
  query: string,
  config: M3Config,
  extraRefs: string[] = [],
): string {
  const raw = query.trim();
  if (!raw) {
    throw new Error("Model name required. Run: m3 models");
  }

  const configured = listConfiguredModels(config);
  const allRefs = [
    ...new Set([...configured.map((m) => m.ref), ...extraRefs]),
  ];

  if (raw.includes("/")) {
    const exact = allRefs.find((r) => r.toLowerCase() === normalizeQuery(raw));
    if (exact) return exact;
    parseModelRef(raw);
    return raw;
  }

  const localRef = `local/${raw}`;
  if (allRefs.some((r) => r.toLowerCase() === localRef)) {
    return allRefs.find((r) => r.toLowerCase() === localRef)!;
  }

  const byModelId = configured.filter((m) => m.modelId.toLowerCase() === normalizeQuery(raw));
  if (byModelId.length === 1) return byModelId[0]!.ref;

  const byAlias = configured.filter(
    (m) => m.alias?.toLowerCase() === normalizeQuery(raw) || m.alias?.toLowerCase().includes(normalizeQuery(raw)),
  );
  if (byAlias.length === 1) return byAlias[0]!.ref;

  const byPartial = allRefs.filter((r) => r.toLowerCase().includes(normalizeQuery(raw)));
  if (byPartial.length === 1) return byPartial[0]!;

  const suggestions = [...configured, ...extraRefs.map((ref) => ({ ref }))]
    .map((m) => ("ref" in m ? m.ref : m))
    .filter((ref) => ref.toLowerCase().includes(normalizeQuery(raw)))
    .slice(0, 8);

  throw new Error(
    suggestions.length
      ? `Unknown model "${raw}". Did you mean: ${suggestions.join(", ")}?`
      : `Unknown model "${raw}". Run: m3 models`,
  );
}

export function formatModelsTable(
  config: M3Config,
  secrets: M3Secrets,
  opts: { localRefs?: { ref: string; label: string }[] } = {},
): string {
  const active = getActiveModelRef(config);
  const lines: string[] = ["Available models", ""];
  lines.push(`Active: ${active}`);
  lines.push("");

  const configured = listConfiguredModels(config, secrets);
  const cloud = configured.filter((m) => !m.localOnly);
  const local = configured.filter((m) => m.localOnly);

  if (cloud.length) {
    lines.push("Cloud / API:");
    for (const m of cloud) {
      const mark = m.ref === active ? "*" : " ";
      const key = m.hasApiKey ? "" : " (no API key)";
      const alias = m.alias ? ` — ${m.alias}` : "";
      lines.push(`  ${mark} ${m.ref}${alias}${key}`);
    }
    lines.push("");
  }

  if (local.length) {
    lines.push("Local (llama.cpp):");
    for (const m of local) {
      const mark = m.ref === active ? "*" : " ";
      const alias = m.alias ? ` — ${m.alias}` : "";
      lines.push(`  ${mark} ${m.ref}${alias}`);
    }
    lines.push("");
  }

  const presets = opts.localRefs ?? [];
  const presetOnly = presets.filter((p) => !configured.some((c) => c.ref === p.ref));
  if (presetOnly.length) {
    lines.push("Local presets (run m3 local --model <id>):");
    for (const p of presetOnly) {
      lines.push(`    ${p.ref} — ${p.label}`);
    }
    lines.push("");
  }

  lines.push("Switch: m3 model <ref|alias|model-id>");
  return lines.join("\n");
}

export function tryResolveModel(
  config: M3Config,
  secrets: M3Secrets,
  ref: string,
): { ok: true; resolved: ReturnType<typeof resolveModel> } | { ok: false; error: string } {
  try {
    return { ok: true, resolved: resolveModel(config, secrets, ref) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
