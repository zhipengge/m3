import type { M3Plugin } from "../types.js";

/** Built-in demo plugin — registers /hello-plugin and HelloEcho tool. */
export const helloPlugin: M3Plugin = {
  id: "hello",
  register(api) {
    api.registerCommand("hello-plugin", () => ({
      action: "reply_only",
      text: "Hello from m3 bundled plugin (hello). Disable via plugins.entries.hello.enabled=false.",
    }));

    api.registerTool({
      name: "HelloEcho",
      description: "Echo input text (demo plugin tool).",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      isReadOnly: true,
      isConcurrencySafe: true,
      execute: async (input) => {
        const text =
          input && typeof input === "object" && "text" in input
            ? String((input as { text: unknown }).text)
            : "";
        return { content: `echo: ${text}` };
      },
    });

    api.log("registered /hello-plugin and HelloEcho tool");
  },
};
