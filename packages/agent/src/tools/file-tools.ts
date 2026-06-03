import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../harness/types.js";
import { resolveWithinWorkspace } from "../security/workspace.js";

const ReadInput = z.object({
  file_path: z.string(),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

export const readTool: ToolDefinition = {
  name: "Read",
  description: "Read a file from the filesystem. Returns numbered lines.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or workspace-relative path" },
      offset: { type: "number", description: "1-based start line" },
      limit: { type: "number", description: "Max lines to read" },
    },
    required: ["file_path"],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async (raw, ctx) => {
    const input = ReadInput.parse(raw);
    const filePath = resolveWithinWorkspace(ctx.cwd, input.file_path, ctx.sandbox, {
      readOnly: true,
    });
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split("\n");
    const start = (input.offset ?? 1) - 1;
    const slice = lines.slice(start, input.limit ? start + input.limit : undefined);
    const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`).join("\n");
    return { content: numbered || "(empty file)" };
  },
};

const WriteInput = z.object({
  file_path: z.string(),
  content: z.string(),
});

export const writeTool: ToolDefinition = {
  name: "Write",
  description: "Write content to a file, creating parent directories if needed.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string" },
    },
    required: ["file_path", "content"],
  },
  needsPermission: true,
  execute: async (raw, ctx) => {
    const input = WriteInput.parse(raw);
    const filePath = resolveWithinWorkspace(ctx.cwd, input.file_path, ctx.sandbox);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, "utf8");
    return { content: `Wrote ${filePath}` };
  },
};

const EditInput = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const editTool: ToolDefinition = {
  name: "Edit",
  description: "Replace a unique string in a file with new content.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  needsPermission: true,
  execute: async (raw, ctx) => {
    const input = EditInput.parse(raw);
    const filePath = resolveWithinWorkspace(ctx.cwd, input.file_path, ctx.sandbox);
    const original = await fs.readFile(filePath, "utf8");
    const count = original.split(input.old_string).length - 1;
    if (count === 0) return { content: "old_string not found", isError: true };
    if (!input.replace_all && count > 1) {
      return { content: `old_string appears ${count} times; use replace_all or provide more context`, isError: true };
    }
    const updated = input.replace_all
      ? original.split(input.old_string).join(input.new_string)
      : original.replace(input.old_string, input.new_string);
    await fs.writeFile(filePath, updated, "utf8");
    return { content: `Updated ${filePath}` };
  },
};
