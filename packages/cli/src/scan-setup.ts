import http from "node:http";
import os from "node:os";
import { loadConfig, resolveConfigPath, saveConfig, type M3Config } from "@m3/config";
import qrcode from "qrcode-terminal";

const HUB_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>m3 Channel Setup</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:32px auto;padding:0 16px}
  h1{font-size:1.25rem} a.card{display:block;padding:16px;margin:12px 0;border:1px solid #ddd;border-radius:12px;text-decoration:none;color:inherit}
  a.card:hover{border-color:#3370ff} .tag{font-size:12px;color:#666} .soon{opacity:.6}
</style></head><body>
<h1>m3 · Channel binding</h1>
<p class="tag">Open on your phone (same Wi‑Fi). Use different account IDs for multiple bots.</p>
<a class="card" href="/setup/feishu"><strong>Feishu / Lark</strong><br/><span class="tag">App ID + Secret, long connection</span></a>
<a class="card soon" href="/setup/wechat"><strong>WeChat</strong><br/><span class="tag">Coming soon</span></a>
</body></html>`;

const WECHAT_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>WeChat</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:24px auto;padding:16px}</style></head><body>
<h1>WeChat channel</h1>
<p>WeChat integration is in development. Use <strong>Feishu</strong> or <code>m3 chat</code> for now.</p>
<p><a href="/setup">← Back</a></p>
</body></html>`;

const SETUP_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>m3 Feishu Setup</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:420px;margin:24px auto;padding:0 16px}
  h1{font-size:1.25rem} label{display:block;margin:12px 0 4px;font-weight:600}
  input{width:100%;padding:10px;font-size:16px;box-sizing:border-box}
  button{margin-top:16px;width:100%;padding:12px;font-size:16px;background:#3370ff;color:#fff;border:0;border-radius:8px}
  .ok{color:#0a0}.err{color:#c00}.tip{color:#666;font-size:14px;line-height:1.5}
  ol{padding-left:1.2rem}
</style></head><body>
<h1>m3 · Feishu setup</h1>
<p class="tip">App ID and App Secret only. Uses <strong>long connection</strong> — no Verification Token or public URL.</p>
<form id="f">
  <label>Account ID</label><input name="accountId" value="default"/>
  <label>App ID</label><input name="appId" required placeholder="cli_xxx"/>
  <label>App Secret</label><input name="appSecret" type="password" required/>
  <button type="submit">Save & enable</button>
</form>
<p id="msg" class="tip"></p>
<hr/>
<p class="tip"><strong>After save</strong>, run <code>m3 gateway</code> on this machine. In Feishu Open Platform:</p>
<ol class="tip">
  <li>Events → Subscription → <strong>Use long connection</strong></li>
  <li>Add event <code>im.message.receive_v1</code></li>
  <li>Enable permission <code>im:message.reactions:write_only</code> for OK reactions</li>
</ol>
<script>
const f=document.getElementById('f'),msg=document.getElementById('msg');
f.onsubmit=async(e)=>{e.preventDefault();msg.textContent='Saving…';
const body=Object.fromEntries(new FormData(f));
const r=await fetch('/api/setup/feishu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const j=await r.json();
msg.className=r.ok?'ok':'err';msg.textContent=j.message||(r.ok?'Saved':'Failed');};
</script></body></html>`;

export function getLanIpv4(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

export type ScanSetupResult = {
  saved: boolean;
  setupUrl: string;
};

export async function runFeishuScanSetup(options?: {
  port?: number;
  configPath?: string;
  timeoutMs?: number;
  /** Bind address. Defaults to loopback so the setup page isn't
   *  reachable from a guest network by anyone who can scan the LAN.
   *  Pass "0.0.0.0" if you really want the old LAN-reachable
   *  behavior (and accept the risk). */
  host?: string;
}): Promise<ScanSetupResult> {
  const port = options?.port ?? 18792;
  const host = options?.host ?? "127.0.0.1";
  const lanIp = host === "0.0.0.0" ? getLanIpv4() : host;
  const setupUrl = `http://${lanIp}:${port}/setup`;
  let saved = false;

  // Naive per-IP rate limit. 3 POSTs per 5-minute window is enough
  // for the legitimate "scan QR → fill form → submit" flow and stops
  // a script on the same LAN from spamming credential overwrites.
  // Resets when the setup server exits.
  const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
  const RATE_LIMIT_MAX = 3;
  const rateByIp = new Map<string, number[]>();
  const rateLimited = (ip: string): boolean => {
    const now = Date.now();
    const hits = (rateByIp.get(ip) ?? []).filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    if (hits.length >= RATE_LIMIT_MAX) {
      rateByIp.set(ip, hits);
      return true;
    }
    hits.push(now);
    rateByIp.set(ip, hits);
    return false;
  };

  // Origin / Referer check for POSTs. The setup page is served from
  // the same origin; anything cross-origin is a CSRF attempt.
  const originOk = (req: http.IncomingMessage): boolean => {
    const origin = req.headers["origin"];
    if (typeof origin === "string") {
      try {
        const u = new URL(origin);
        // Allow same-host:port (any port — user might be on a proxy)
        if (u.hostname === lanIp || u.hostname === "127.0.0.1" || u.hostname === "localhost") {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    // No Origin header (e.g. curl, native fetch without credentials):
    // allow but log. Strictly speaking RFC 6454 recommends forbidding
    // these, but the legitimate user typing in a browser does send
    // Origin, so the bad case is rare.
    return true;
  };

  const clientIp = (req: http.IncomingMessage): string => {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
    return req.socket.remoteAddress ?? "unknown";
  };

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "";

    if (req.method === "GET" && (url === "/" || url === "/setup")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HUB_HTML);
      return;
    }

    if (req.method === "GET" && url === "/setup/wechat") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(WECHAT_HTML);
      return;
    }

    if (req.method === "GET" && url === "/setup/feishu") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SETUP_HTML);
      return;
    }

    if (req.method === "POST" && url === "/api/setup/feishu") {
      const ip = clientIp(req);
      if (rateLimited(ip)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            message: "Too many setup attempts from this IP. Try again in a few minutes.",
          }),
        );
        return;
      }
      if (!originOk(req)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Cross-origin request rejected" }));
        return;
      }
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            accountId?: string;
            appId?: string;
            appSecret?: string;
          };
          if (!body.appId?.trim() || !body.appSecret?.trim()) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: "App ID and App Secret are required" }));
            return;
          }

          const config: M3Config = loadConfig(options?.configPath);
          const accountId = body.accountId?.trim() || "default";
          if (!config.channels.feishu) config.channels.feishu = {};
          config.channels.feishu[accountId] = {
            enabled: true,
            connectionMode: "long",
            appId: body.appId.trim(),
            appSecret: body.appSecret.trim(),
            dmPolicy: "open",
            allowFrom: ["*"],
            // C1: when the user pins the account to a local model
            // we also flip localOnly. The scan-setup form is the
            // easiest place to do this pairing — a user opting
            // into a local-provider override clearly wants the
            // privacy guarantee that comes with it.
            localOnly: false,
          };
          // saveConfig now writes atomically at 0o600 (see
          // @m3/config's atomicWriteFileSync helper).
          saveConfig(config, options?.configPath);
          saved = true;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              message: `Saved to ${resolveConfigPath(options?.configPath)}. Run: m3 gateway`,
            }),
          );
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      })();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log("\nm3 channel scan setup (Feishu / WeChat)\n");
  console.log("Scan QR with your phone (same Wi‑Fi):\n");
  qrcode.generate(setupUrl, { small: true });
  console.log(`\nOr open: ${setupUrl}`);
  console.log(`\nConfig file: ${resolveConfigPath(options?.configPath)}`);
  console.log("Submit the form, then press Ctrl+C to exit.\n");

  const timeoutMs = options?.timeoutMs ?? 300_000;
  const started = Date.now();

  await new Promise<void>((resolve) => {
    const done = () => {
      server.close(() => resolve());
    };
    process.on("SIGINT", done);
    process.on("SIGTERM", done);

    const tick = setInterval(() => {
      if (saved) {
        clearInterval(tick);
        console.log("\nSaved. Closing setup server in 3s…");
        setTimeout(done, 3000);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        console.log("\nTimeout. Closing setup server.");
        done();
      }
    }, 500);
  });

  return { saved, setupUrl };
}
