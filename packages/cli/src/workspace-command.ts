import { Command } from "commander";
import { status } from "./output.js";

/**
 * `m3 workspaces` — list, inspect, rename the workspaces m3
 * has seen on this machine. Each entry is the SHA-derived
 * identity used to scope memory, last-model, and (future)
 * project-specific config.
 *
 *   m3 workspaces                # list all
 *   m3 workspaces show           # current cwd's record
 *   m3 workspaces rename <name>  # set a human label
 *   m3 workspaces prune          # drop entries older than 90d
 */
export function registerWorkspaceCommand(program: Command): void {
  const cmd = program
    .command("workspaces")
    .description("List, inspect, rename m3 workspaces (per-cwd scoping)");

  cmd
    .command("list", { isDefault: true })
    .description("List all known workspaces, newest first")
    .action(async () => {
      const { listWorkspaces } = await import("@m3/config");
      const all = listWorkspaces();
      if (all.length === 0) {
        status("info", "Workspaces", "(none yet — launch a session in any directory)");
        return;
      }
      status("info", "Workspaces", `${all.length} known`);
      for (const w of all) {
        const marker = w.absPath === process.cwd() ? "→" : " ";
        console.log(
          `  ${marker} ${w.id}  ${w.label.padEnd(28)}  ${w.absPath}  (last: ${w.lastSeenAt.slice(0, 10)})`,
        );
      }
    });

  cmd
    .command("show")
    .description("Show the current workspace's record")
    .action(async () => {
      const { resolveWorkspace } = await import("@m3/config");
      const w = resolveWorkspace();
      console.log(`  id:         ${w.id}`);
      console.log(`  label:      ${w.label}`);
      console.log(`  absPath:    ${w.absPath}`);
      console.log(`  firstSeen:  ${w.firstSeenAt}`);
      console.log(`  lastSeen:   ${w.lastSeenAt}`);
    });

  cmd
    .command("rename <label>")
    .description("Set a human-readable label for the current workspace")
    .action(async (label: string) => {
      const { resolveWorkspace, renameWorkspace } = await import("@m3/config");
      const w = resolveWorkspace();
      const updated = renameWorkspace(w.absPath, label);
      if (!updated) {
        status("err", "Rename", "workspace not found in store");
        process.exitCode = 1;
        return;
      }
      status("ok", "Renamed", `${updated.id} → "${updated.label}"`);
    });

  cmd
    .command("prune")
    .description("Remove workspaces not seen in 90 days")
    .action(async () => {
      const { loadWorkspaceStore, expandHome, atomicWriteFileSync } = await import("@m3/config");
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const store = loadWorkspaceStore();
      const before = Object.keys(store.workspaces).length;
      const kept: typeof store.workspaces = {};
      for (const [k, w] of Object.entries(store.workspaces)) {
        if (Date.parse(w.lastSeenAt) >= cutoff) {
          kept[k] = w;
        }
      }
      store.workspaces = kept;
      atomicWriteFileSync(expandHome("~/.m3/workspaces.json"), JSON.stringify(store, null, 2));
      const removed = before - Object.keys(kept).length;
      status(
        "ok",
        "Pruned",
        `${removed} workspace(s) older than 90 days removed; ${Object.keys(kept).length} remaining`,
      );
    });
}
