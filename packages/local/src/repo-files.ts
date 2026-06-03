import type { QuantLevel } from "./constants.js";
import type { ModelMirror } from "./types.js";
import { buildDownloadUrl } from "./mirror.js";
import type { ResolvedLocalModel } from "./model-spec.js";

type TreeEntry = { path?: string; type?: string };

export async function listRepoGgufFiles(mirror: ModelMirror, repo: string): Promise<string[]> {
  if (mirror === "huggingface") {
    const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`, {
      headers: { Accept: "application/json", "User-Agent": "m3-local" },
    });
    if (!res.ok) {
      throw new Error(`Failed to list Hugging Face repo ${repo} (${res.status})`);
    }
    const data = (await res.json()) as TreeEntry[];
    return data
      .filter((e) => e.path?.endsWith(".gguf"))
      .map((e) => e.path!.split("/").pop()!);
  }

  const res = await fetch(
    `https://www.modelscope.cn/api/v1/models/${repo}/repo?Revision=master`,
    { headers: { "User-Agent": "m3-local" } },
  );
  if (!res.ok) {
    throw new Error(`Failed to list ModelScope repo ${repo} (${res.status})`);
  }
  const body = (await res.json()) as { Data?: { Files?: { Path: string }[] } };
  const files = body.Data?.Files ?? [];
  return files
    .filter((f) => f.Path?.endsWith(".gguf"))
    .map((f) => f.Path.split("/").pop()!);
}

/** Pick main weights + optional mmproj from a repo file listing. */
export function pickGgufFiles(
  files: string[],
  quant: QuantLevel,
  vision: boolean,
): { llm: string; mmproj?: string } {
  const quantNeedle = quant.replace(/_/g, "_");
  const mmprojCandidates = files.filter((f) => /mmproj/i.test(f));
  const llmCandidates = files.filter(
    (f) =>
      !/mmproj/i.test(f) &&
      !/vision-encoder/i.test(f) &&
      (f.includes(quantNeedle) || f.includes(quant.replace("_", "-"))),
  );

  const llm =
    llmCandidates.sort((a, b) => a.length - b.length)[0] ??
    files.find((f) => !/mmproj/i.test(f) && !/vision-encoder/i.test(f) && f.endsWith(".gguf"));

  if (!llm) {
    throw new Error(
      `No GGUF matching quant ${quant} in repo. Files: ${files.slice(0, 12).join(", ")}${files.length > 12 ? "…" : ""}`,
    );
  }

  if (!vision) {
    return { llm };
  }

  const mmproj =
    mmprojCandidates.find((f) => /F16/i.test(f)) ??
    mmprojCandidates.find((f) => f.includes(quantNeedle)) ??
    mmprojCandidates[0];

  if (!mmproj) {
    throw new Error(
      `Vision model requires mmproj GGUF in repo. Found: ${files.slice(0, 12).join(", ")}`,
    );
  }

  return { llm, mmproj };
}

export async function resolveDownloadFiles(
  mirror: ModelMirror,
  spec: ResolvedLocalModel,
  quant: QuantLevel,
  onLog?: (line: string) => void,
): Promise<{ llm: string; mmproj?: string }> {
  const fixed = spec.files?.[quant];
  if (fixed) {
    return { llm: fixed.llm, mmproj: fixed.mmproj };
  }

  onLog?.(`  listing ${spec.repo} on ${mirror}…`);
  const listing = await listRepoGgufFiles(mirror, spec.repo);
  onLog?.(`  found ${listing.length} GGUF file(s)`);
  const picked = pickGgufFiles(listing, quant, spec.vision);
  onLog?.(`  selected: ${picked.llm}${picked.mmproj ? ` + ${picked.mmproj}` : ""}`);
  return picked;
}

export function filenamesToDownload(files: { llm: string; mmproj?: string }): string[] {
  return files.mmproj ? [files.llm, files.mmproj] : [files.llm];
}

export { buildDownloadUrl };
