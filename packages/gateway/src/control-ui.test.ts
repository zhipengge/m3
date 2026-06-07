import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleControlHttp, type ControlUiContext } from "./control-ui.js";
import { verifyGatewayToken, writeUnauthorized } from "./auth.js";

function makeReq(headers: Record<string, string> = {}, url = "/api/system"): IncomingMessage {
  return { headers, url, method: "GET" } as unknown as IncomingMessage;
}

function makeRes() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    headers: undefined as Record<string, string> | undefined,
    writeHead: vi.fn(function (this: any, code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      this.headers = headers;
      return this;
    }),
    end: vi.fn(function (this: any, body?: string) {
      this.body = body;
      return this;
    }),
  };
  return res as unknown as ServerResponse & {
    statusCode?: number;
    body?: string;
    headers?: Record<string, string>;
  };
}

const baseCtx: ControlUiContext = {
  startedAt: Date.now(),
  version: "0.2.0",
  getChannels: () => [],
  getSessions: () => [],
  getSystem: () => ({}) as any,
  getLogs: () => [],
  getPairings: () => [],
};

describe("verifyGatewayToken", () => {
  it("accepts Bearer header", () => {
    const req = makeReq({ authorization: "Bearer secret-token" });
    expect(verifyGatewayToken(req, "secret-token")).toBe(true);
  });

  it("accepts ?token= query", () => {
    const req = makeReq({}, "/api/system?token=secret-token");
    expect(verifyGatewayToken(req, "secret-token")).toBe(true);
  });

  it("rejects wrong token", () => {
    expect(verifyGatewayToken(makeReq({ authorization: "Bearer wrong" }), "secret")).toBe(false);
    expect(verifyGatewayToken(makeReq({}, "/api/system?token=wrong"), "secret")).toBe(false);
  });

  it("rejects when no credential is presented", () => {
    expect(verifyGatewayToken(makeReq(), "secret")).toBe(false);
  });
});

describe("writeUnauthorized", () => {
  it("emits 401 with WWW-Authenticate: Bearer", () => {
    const res = makeRes();
    writeUnauthorized(res);
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["www-authenticate"]).toMatch(/^Bearer /);
  });
});

describe("handleControlHttp — auth gate", () => {
  it("rejects /api/* with 401 when authToken is set and absent", () => {
    const res = makeRes();
    const ctx = { ...baseCtx, authToken: "secret" };
    const handled = handleControlHttp(makeReq({}, "/api/system"), res, ctx);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("Unauthorized");
  });

  it("rejects /dashboard with 401 when authToken is set and absent", () => {
    const res = makeRes();
    const ctx = { ...baseCtx, authToken: "secret" };
    handleControlHttp(makeReq({}, "/dashboard"), res, ctx);
    expect(res.statusCode).toBe(401);
  });

  it("allows /api/* when authToken matches ?token=", () => {
    const res = makeRes();
    const ctx = { ...baseCtx, authToken: "secret" };
    handleControlHttp(makeReq({}, "/api/system?token=secret"), res, ctx);
    expect(res.statusCode).toBe(200);
  });

  it("allows /api/* when authToken matches Bearer header", () => {
    const res = makeRes();
    const ctx = { ...baseCtx, authToken: "secret" };
    handleControlHttp(makeReq({ authorization: "Bearer secret" }, "/api/system"), res, ctx);
    expect(res.statusCode).toBe(200);
  });

  it("allows /api/* when no authToken is configured (loopback-only mode)", () => {
    const res = makeRes();
    handleControlHttp(makeReq({}, "/api/system"), res, baseCtx);
    expect(res.statusCode).toBe(200);
  });

  it("serves /dashboard HTML when no authToken is configured", () => {
    const res = makeRes();
    handleControlHttp(makeReq({}, "/dashboard"), res, baseCtx);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("m3 Gateway");
  });
});
