import { memo, useEffect, useState } from "react";
import { spawn } from "node:child_process";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

type Props = {
  model?: string;
  workspace?: string;
};

/**
 * HeaderBar — model + cwd + git branch (with dirty marker), all in
 * one row above the conversation. The bottom StatusBar stays for
 * live gauges (tokens / ctx% / duration / tools), so each bar has
 * a single responsibility: top = identity, bottom = live state.
 *
 * The git info refreshes every 5s on a setInterval; a failure
 * (no git installed, not a repo, etc.) just keeps the last
 * known value or stays empty. No exceptions, no UI flicker.
 */
function readGitState(cwd: string): Promise<{ branch: string; dirty: boolean } | null> {
  return new Promise((resolve) => {
    try {
      // `git status --porcelain -b 2>&1` outputs porcelain (one
      // changed file per line, prefixed with XY status) followed by a
      // line that looks like `## <branch>…`. We capture both with a
      // single spawn so we don't race with a parallel `rev-parse`.
      const child = spawn("git", ["status", "--porcelain", "-b"], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      let out = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        if (code !== 0) return resolve(null);
        const m = /^## ([^\s.]+)/.exec(out);
        if (!m) return resolve(null);
        // Porcelain is the rest of the output (file lines). Empty
        // porcelain = clean.
        const porcelain = out.replace(/^##[^\n]*\n/, "").trim();
        resolve({ branch: m[1]!, dirty: porcelain.length > 0 });
      });
    } catch {
      resolve(null);
    }
  });
}

function HeaderBarImpl(props: Props) {
  const { model, workspace } = props;
  const [git, setGit] = useState<{ branch: string; dirty: boolean } | null>(null);
  // Initial probe + 5s refresh. Cheap (one spawn per interval);
  // skipped silently if git isn't installed.
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const probe = () => {
      readGitState(workspace).then((g) => {
        if (!cancelled) setGit(g);
      });
    };
    probe();
    const id = setInterval(probe, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [workspace]);

  const parts: React.ReactNode[] = [];
  if (model) {
    parts.push(
      <Text key="model" color={theme.accent} bold wrap="truncate-end">
        {model}
      </Text>,
    );
  }
  if (workspace) {
    // Show only the tail of the path when the full path would crowd
    // the bar (e.g. very deep monorepo paths). "~" is a nicer
    // placeholder than a raw /Users/... prefix.
    const tail = workspace.replace(/^.*\//, "~/");
    parts.push(
      <Text key="cwd" color={theme.muted} wrap="truncate-end">
        {tail}
      </Text>,
    );
  }
  if (git) {
    parts.push(
      <Text key="git" color={theme.muted} wrap="truncate-end">
        {`git: ${git.branch}${git.dirty ? " *" : ""}`}
      </Text>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginBottom={0}
      flexDirection="row"
      flexShrink={0}
      width="100%"
      overflowX="hidden"
    >
      {parts.map((p, i) => (
        <Box key={i} gap={1}>
          {i > 0 ? <Text color={theme.muted}>·</Text> : null}
          {p}
        </Box>
      ))}
    </Box>
  );
}

export const HeaderBar = memo(HeaderBarImpl);
