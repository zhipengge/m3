import readline from "node:readline";

function parseYesNo(line: string): boolean | null {
  const t = line.trim().toLowerCase();
  if (t === "" || t === "y" || t === "yes" || t === "是") return true;
  if (t === "n" || t === "no" || t === "否") return false;
  return null;
}

function formatWorkspacePrompt(workspace: string): string {
  return [
    "",
    "\x1b[1mm3 workspace access\x1b[0m",
    "",
    "Allow m3 to read and write files in this folder for this session?",
    "",
    `  \x1b[36m${workspace}\x1b[0m`,
    "",
    "\x1b[2mOptions:\x1b[0m",
    "  \x1b[32mY\x1b[0m / \x1b[32m是\x1b[0m  — Allow read & write (default, press Enter)",
    "  \x1b[33mn\x1b[0m / \x1b[33m否\x1b[0m  — Deny and exit",
    "",
  ].join("\n");
}

const CHOICE_PROMPT = "Choice \x1b[1m[Y/n]\x1b[0m: ";

/**
 * Ask once at m3 chat startup whether this session may read/write the workspace
 * (Claude Code–style folder trust).
 */
export async function promptWorkspaceAccess(workspace: string): Promise<boolean> {
  if (process.env.M3_SKIP_WORKSPACE_GRANT === "1") return true;
  if (!process.stdin.isTTY) return true;

  process.stdout.write(formatWorkspacePrompt(workspace));

  return new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(CHOICE_PROMPT, (answer) => {
      rl.close();
      const decision = parseYesNo(answer);
      if (decision === null) {
        process.stdout.write(
          "\x1b[33mInvalid choice. Type Y (allow) or n (deny).\x1b[0m\n\n",
        );
        void promptWorkspaceAccess(workspace).then(resolve);
        return;
      }
      if (decision) {
        process.stdout.write("\x1b[32m✓ Workspace access granted.\x1b[0m\n\n");
      } else {
        process.stdout.write("\x1b[33m✗ Workspace access denied.\x1b[0m\n");
      }
      resolve(decision);
    });
  });
}
