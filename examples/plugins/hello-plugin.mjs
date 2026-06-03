/**
 * External m3 plugin example (ESM).
 *
 * Enable in ~/.m3/m3.json:
 *   plugins: { paths: ["/absolute/path/to/m3/examples/plugins/hello-plugin.mjs"] }
 */
export default {
  id: "hello-external",
  register(api) {
    api.registerCommand("ext-hello", () => ({
      action: "reply_only",
      text: "Hello from external plugin (hello-external).",
    }));
    api.log("external hello-plugin loaded");
  },
};
