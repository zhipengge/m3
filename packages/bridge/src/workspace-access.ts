import path from "node:path";

/** Tools that create or modify files under the workspace. */
export function isFileMutationTool(toolName: string): boolean {
  if (toolName === "Write" || toolName === "Edit") return true;
  if (toolName === "Bash") return false;
  const lower = toolName.toLowerCase();
  return (
    lower.endsWith("__write_file") ||
    lower.endsWith("__edit_file") ||
    lower.endsWith("__create_directory") ||
    lower.includes("write_file")
  );
}

export function normalizeWorkspacePath(dir: string): string {
  return path.resolve(dir);
}

export function isSameWorkspace(a: string, b: string): boolean {
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}
