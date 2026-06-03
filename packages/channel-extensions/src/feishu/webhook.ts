import http from "node:http";
import type { ChannelRuntimeContext } from "@m3/channels";
import { handleFeishuWebhookPayload } from "./inbound.js";

type WebhookServer = {
  port: number;
  close: () => Promise<void>;
};

export function startFeishuWebhookServer(params: {
  accountId: string;
  port: number;
  path: string;
  verificationToken?: string;
  runtime: ChannelRuntimeContext;
  abortSignal: AbortSignal;
}): WebhookServer {
  const normalizedPath = params.path.startsWith("/") ? params.path : `/${params.path}`;

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || req.url?.split("?")[0] !== normalizedPath) {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");

      let payload: unknown;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        res.writeHead(400);
        res.end("invalid json");
        return;
      }

      const body = payload as {
        challenge?: string;
        token?: string;
        type?: string;
        header?: { token?: string };
      };

      if (body.type === "url_verification" && body.challenge) {
        if (
          params.verificationToken &&
          body.token &&
          body.token !== params.verificationToken
        ) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ challenge: body.challenge }));
        return;
      }

      if (
        params.verificationToken &&
        body.header?.token &&
        body.header.token !== params.verificationToken
      ) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }

      try {
        await handleFeishuWebhookPayload({
          runtime: params.runtime,
          accountId: params.accountId,
          payload,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      } catch (err) {
        params.runtime.log(
          `feishu webhook error: ${err instanceof Error ? err.message : String(err)}`,
        );
        res.writeHead(500);
        res.end("error");
      }
    })();
  });

  server.listen(params.port, "127.0.0.1");

  params.abortSignal.addEventListener("abort", () => {
    server.close();
  });

  return {
    port: params.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
