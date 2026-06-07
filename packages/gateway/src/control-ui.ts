import type { ChannelAccountSnapshot } from "@m3/channels";
import type { PairingRecord, SessionMapping } from "@m3/bridge";
import type { LogEntry } from "./event-log.js";
import type { SystemInfoPayload } from "./system-info.js";
import { verifyGatewayToken, writeUnauthorized } from "./auth.js";

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>m3 Control</title>
<style>
  :root{--bg:#0f1117;--card:#1a1d27;--text:#e6e8ef;--muted:#8b90a5;--accent:#5b8def;--ok:#3dd68c;--err:#f07178}
  *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui;background:var(--bg);color:var(--text)}
  header{padding:16px 24px;border-bottom:1px solid #2a2f3d;display:flex;align-items:center;gap:12px}
  header h1{margin:0;font-size:1.1rem} header span{color:var(--muted);font-size:.85rem}
  main{padding:20px 24px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .card{background:var(--card);border-radius:12px;padding:16px;border:1px solid #2a2f3d}
  .card h2{margin:0 0 12px;font-size:.95rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .metric{font-size:1.75rem;font-weight:700} .sub{color:var(--muted);font-size:.8rem;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #2a2f3d}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.75rem}
  .ok{background:#1e3a2f;color:var(--ok)} .err{background:#3a1e1e;color:var(--err)} .warn{background:#3a321e;color:#e6c84a}
  #log{font-family:ui-monospace,monospace;font-size:.75rem;max-height:120px;overflow:auto;color:var(--muted)}
  a{color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>m3 Gateway</h1>
  <span id="status">loading…</span>
</header>
<main>
  <section class="card"><h2>System</h2>
    <div class="metric" id="memPct">—</div>
    <div class="sub" id="memDetail">—</div>
    <div class="sub" id="cpuLoad">—</div>
    <div class="sub" id="proc">—</div>
  </section>
  <section class="card"><h2>Gateway</h2>
    <div class="metric" id="uptime">—</div>
    <div class="sub" id="version">—</div>
  </section>
  <section class="card" style="grid-column:1/-1"><h2>Channels</h2>
    <table><thead><tr><th>Account</th><th>Status</th><th>Error</th></tr></thead><tbody id="channels"></tbody></table>
  </section>
  <section class="card" style="grid-column:1/-1"><h2>Sessions</h2>
    <table><thead><tr><th>Session key</th><th>Channel</th><th>Peer</th><th>Updated</th></tr></thead><tbody id="sessions"></tbody></table>
  </section>
  <section class="card" style="grid-column:1/-1"><h2>Pairing</h2>
    <table><thead><tr><th>Channel</th><th>Peer</th><th>Code</th><th>Status</th></tr></thead><tbody id="pairings"></tbody></table>
  </section>
  <section class="card" style="grid-column:1/-1"><h2>Event log</h2>
    <pre id="log"></pre>
  </section>
</main>
<script>
async function j(u){const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')}
async function tick(){
  try{
    const [h,sys,sess,ch,logs,pair]=await Promise.all([j('/health'),j('/api/system'),j('/api/sessions'),j('/api/channels'),j('/api/logs'),j('/api/pairings')]);
    document.getElementById('status').textContent=h.ok?'online':'degraded';
    document.getElementById('memPct').textContent=sys.memory.usedPercent+'% RAM';
    document.getElementById('memDetail').textContent=sys.memory.usedMb+' / '+sys.memory.totalMb+' MB · '+sys.cpus+' CPUs';
    document.getElementById('cpuLoad').textContent='load: '+sys.loadAvg.map(n=>n.toFixed(2)).join(' ');
    document.getElementById('proc').textContent='pid '+sys.process.pid+' · rss '+sys.process.rssMb+'MB · node '+sys.nodeVersion;
    document.getElementById('uptime').textContent=Math.floor(h.uptimeMs/1000)+'s';
    document.getElementById('version').textContent=h.version+' · '+sys.hostname;
    const ct=document.getElementById('channels');ct.innerHTML='';
    for(const row of ch.channels||[]){
      const tr=document.createElement('tr');
      const st=row.running&&row.configured?'<span class="badge ok">running</span>':row.configured?'<span class="badge warn">stopped</span>':'<span class="badge err">not configured</span>';
      tr.innerHTML='<td>'+esc((row.channelId||'')+':'+row.accountId)+'</td><td>'+st+'</td><td>'+esc(row.lastError||'')+'</td>';
      ct.appendChild(tr);
    }
    const st=document.getElementById('sessions');st.innerHTML='';
    for(const row of sess.sessions||[]){
      const tr=document.createElement('tr');
      tr.innerHTML='<td>'+esc(row.sessionKey)+'</td><td>'+esc(row.channel)+'</td><td>'+esc(row.peerId)+'</td><td>'+esc(row.updatedAt||'')+'</td>';
      st.appendChild(tr);
    }
    const pt=document.getElementById('pairings');pt.innerHTML='';
    for(const row of pair.pairings||[]){
      const tr=document.createElement('tr');
      const st2=row.approved?'<span class="badge ok">approved</span>':'<span class="badge warn">pending</span>';
      tr.innerHTML='<td>'+esc(row.channel)+'</td><td>'+esc(row.peerId)+'</td><td>'+esc(row.code)+'</td><td>'+st2+'</td>';
      pt.appendChild(tr);
    }
    document.getElementById('log').textContent=(logs.logs||[]).map(l=>'['+l.level+'] '+l.ts+' '+l.message).join('\\n')||'(empty)';
  }catch(e){document.getElementById('status').textContent='error: '+e.message}
}
tick();setInterval(tick,3000);
</script>
</body>
</html>`;

export type ControlUiContext = {
  startedAt: number;
  version: string;
  /**
   * When set, every control-UI endpoint (the HTML page and all
   * `/api/*` JSON routes) requires the matching bearer token. When
   * unset, the UI is reachable from anyone who can open a TCP
   * connection — the caller is responsible for binding to loopback.
   */
  authToken?: string;
  getChannels: () => ChannelAccountSnapshot[];
  getSessions: () => SessionMapping[];
  getSystem: () => SystemInfoPayload;
  getLogs: () => LogEntry[];
  getPairings: () => PairingRecord[];
};

export function handleControlHttp(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  ctx: ControlUiContext,
): boolean {
  const url = req.url?.split("?")[0] ?? "";

  // Auth gate. When an authToken is configured, every control-UI
  // route requires it via the Authorization: Bearer header or the
  // ?token= query param. Without a token, the dashboard was world-
  // readable whenever the gateway was bound to a non-loopback
  // address — session keys, pairing codes, system info, and the
  // event log all leaked. /health is intentionally not gated here
  // (load balancers need it).
  if (ctx.authToken && !verifyGatewayToken(req, ctx.authToken)) {
    writeUnauthorized(res);
    return true;
  }

  if (req.method === "GET" && (url === "/" || url === "/dashboard")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return true;
  }

  if (req.method === "GET" && url === "/api/system") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(ctx.getSystem()));
    return true;
  }

  if (req.method === "GET" && url === "/api/sessions") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sessions: ctx.getSessions() }));
    return true;
  }

  if (req.method === "GET" && url === "/api/channels") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ channels: ctx.getChannels() }));
    return true;
  }

  if (req.method === "GET" && url === "/api/logs") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ logs: ctx.getLogs() }));
    return true;
  }

  if (req.method === "GET" && url === "/api/pairings") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ pairings: ctx.getPairings() }));
    return true;
  }

  return false;
}
