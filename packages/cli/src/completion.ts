import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function completionDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/completions");
}

export function printCompletion(shell: "zsh" | "bash"): void {
  const file = shell === "zsh" ? "m3.zsh" : "m3.bash";
  const full = path.join(completionDir(), file);
  if (!fs.existsSync(full)) {
    throw new Error(`Completion file not found: ${full}`);
  }
  process.stdout.write(fs.readFileSync(full, "utf8"));
}

function ensureLineInFile(filePath: string, line: string, marker: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes(marker)) return false;
  fs.appendFileSync(filePath, `\n# m3 shell completion (${marker})\n${line}\n`);
  return true;
}

export function installCompletion(shell: "zsh" | "bash"): { ok: boolean; message: string } {
  const home = os.homedir();
  const src = path.join(completionDir(), shell === "zsh" ? "m3.zsh" : "m3.bash");

  if (!fs.existsSync(src)) {
    return { ok: false, message: `Missing completion script: ${src}` };
  }

  if (shell === "zsh") {
    const zfunc = path.join(home, ".zfunc");
    fs.mkdirSync(zfunc, { recursive: true });
    const dest = path.join(zfunc, "_m3");
    fs.copyFileSync(src, dest);

    const zshrc = path.join(home, ".zshrc");
    const fpathLine = 'fpath=(~/.zfunc $fpath)';
    const zshrcContent = fs.existsSync(zshrc) ? fs.readFileSync(zshrc, "utf8") : "";
    const addedFpath = zshrcContent.includes("~/.zfunc")
      ? false
      : ensureLineInFile(zshrc, fpathLine, "m3-zfunc-fpath");
    const addedCompinit = zshrcContent.includes("compinit")
      ? false
      : ensureLineInFile(zshrc, "autoload -Uz compinit && compinit", "m3-compinit");

    fs.mkdirSync(path.join(home, ".m3", "completions"), { recursive: true });
    fs.copyFileSync(src, path.join(home, ".m3/completions/m3.zsh"));

    return {
      ok: true,
      message: [
        `Installed: ${dest}`,
        addedFpath ? "Updated ~/.zshrc (fpath)" : "~/.zshrc already has fpath",
        addedCompinit ? "Updated ~/.zshrc (compinit)" : "",
        "Run: exec zsh   OR   source ~/.zshrc",
        "Test: m3 <TAB>",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const bashrc = path.join(home, ".bashrc");
  const profile = path.join(home, ".bash_profile");
  const line = 'eval "$(m3 completion bash)"';
  const marker = "m3-bash-completion";

  fs.mkdirSync(path.join(home, ".m3", "completions"), { recursive: true });
  fs.copyFileSync(src, path.join(home, ".m3/completions/m3.bash"));

  let updated = false;
  if (fs.existsSync(bashrc)) {
    updated = ensureLineInFile(bashrc, line, marker) || updated;
  }
  if (fs.existsSync(profile)) {
    updated = ensureLineInFile(profile, line, marker) || updated;
  }

  return {
    ok: true,
    message: [
      `Copied to ~/.m3/completions/m3.bash`,
      updated ? "Updated shell profile with eval line" : "Add manually: eval \"$(m3 completion bash)\"",
      "Run: source ~/.bashrc",
      "Test: m3 <TAB>",
    ].join("\n"),
  };
}
