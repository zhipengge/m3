import { describe, expect, it } from "vitest";
import { parseFeishuEventBody } from "./inbound.js";

describe("feishu inbound parse", () => {
  it("parses im.message.receive_v1 envelope", () => {
    const event = parseFeishuEventBody({
      schema: "2.0",
      header: { event_type: "im.message.receive_v1" },
      event: {
        message: {
          message_id: "om_x",
          chat_id: "oc_x",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hello" }),
        },
        sender: { sender_id: { open_id: "ou_x" } },
      },
    });
    expect(event?.message?.message_type).toBe("text");
  });
});
