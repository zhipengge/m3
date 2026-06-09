import type { IncomingMessage } from "node:http";

/**
 * Validate the gateway bearer token from the Authorization header or
 * the `?token=` query string. Used by the WebSocket `verifyClient`
 * (server.ts) and the control-UI HTTP gate (control-ui.ts). When the
 * gateway is bound to a non-loopback address and `authToken` is set,
 * every `/api/*` and `/dashboard` request must present the token.
 *
 * Returns false (not throws) on any malformed input so the call site
 * can issue a 401 instead of a 500.
 */
export function verifyGatewayToken(req: IncomingMessage, expected: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    if (header.slice("Bearer ".length) === expected) return true;
  }
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.searchParams.get("token") === expected) return true;
  } catch {
    // malformed URL — fall through
  }
  return false;
}

/**
 * Write a 401 response with a `WWW-Authenticate: Bearer` challenge so
 * well-behaved clients know how to retry. Used by control-ui.ts when
 * the request lacks a valid token.
 */
export function writeUnauthorized(res: import("node:http").ServerResponse): void {
  res.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": 'Bearer realm="m3-control"',
  });
  res.end("Unauthorized — set Authorization: Bearer <authToken> or ?token=<authToken>\n");
}
