import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sharedReport } from "@/server/shared-report";
import { COOKIE, makeSession } from "@/server/portal-session";

const secret = "s".repeat(40);
const origin = "https://portal.example";
const version = "11111111-1111-4111-8111-111111111111";
let cookie = "";
let state: any;
let uploads: Map<string, Uint8Array>;
let deny = false;
let failStorage = false;
let failPublish = false;
let comparisonState: Map<string, any>;
const backend = vi.fn();
const data = gzipSync(JSON.stringify({ schemaVersion: 1, payload: { headers: ["Id Regra"], rows: [[1]] } }));
function request(method = "GET", path = "shared/meta.json", headers: Record<string, string> = {}) {
  return new Request(`${origin}/app/${path}`, {
    method, headers: { Cookie: cookie, ...(method === "POST" ? {
      Origin: origin, "Content-Type": "application/gzip", "X-Report-Version": "initial",
      "X-Report-Source": encodeURIComponent("Comissão.xlsx"), "X-Report-Count": "1",
    } : {}), ...headers }, ...(method === "POST" ? { body: data } : {}),
  });
}
beforeEach(async () => {
  vi.stubEnv("SUPABASE_URL", "https://backend.example");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "admin-test");
  vi.stubEnv("SESSION_SECRET", secret);
  cookie = `${COOKIE}=${(await makeSession("token", 1800, secret)).value}`;
  state = { revision: null };
  uploads = new Map(); comparisonState = new Map(); deny = false; failStorage = false; failPublish = false;
  backend.mockReset();
  backend.mockImplementation(async (input: any, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json(deny ? {} : { id: "user", email: "ana@adpromotora.com.br", email_confirmed_at: "2026-01-01" });
    expect(init.headers.apikey).toBe("admin-test");
    if (url.pathname === "/rest/v1/pricing_comparison_state") {
      const key = url.searchParams.get("bank_key") + "|" + url.searchParams.get("relationship");
      return Response.json(comparisonState.has(key) ? [comparisonState.get(key)] : []);
    }
    if (url.pathname === "/rest/v1/rpc/publish_pricing_comparison") {
      const b = JSON.parse(init.body), key = "eq." + b.p_bank + "|eq." + b.p_relationship;
      const old = comparisonState.get(key);
      if ((old?.revision ?? null) !== b.p_expected) return Response.json({ code: "40001" }, { status: 409 });
      const row = { revision: b.p_revision, source_name: b.p_source, record_count: b.p_count, updated_at: "2026-10-27T12:00:00Z" };
      comparisonState.set(key, row);
      return Response.json({ revision: row.revision, source: row.source_name, records: row.record_count, updatedAt: row.updated_at });
    }
    if (url.pathname === "/rest/v1/pricing_shared_state") return Response.json([state]);
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (failStorage) return new Response(null, { status: 503 });
      if (init.method === "POST") { uploads.set(url.pathname.split("/").pop()!, init.body); return Response.json({}); }
      const bytes = uploads.get(url.pathname.split("/").pop()!);
      return bytes ? new Response(bytes as BodyInit) : new Response(null, { status: 404 });
    }
    if (url.pathname === "/rest/v1/rpc/publish_pricing_report") {
      const body = JSON.parse(init.body);
      if (failPublish) return Response.json({ code: "XX000" }, { status: 500 });
      if (body.p_expected !== state.revision) return Response.json({ code: "40001" }, { status: 409 });
      state = { revision: body.p_revision, source_name: body.p_source, record_count: body.p_count, updated_at: "2026-10-27T12:00:00Z" };
      return Response.json({ revision: state.revision, source: state.source_name, records: state.record_count, updatedAt: state.updated_at });
    }
    throw new Error("Unexpected backend path");
  });
  vi.stubGlobal("fetch", backend);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("private shared report", () => {
  it("returns no shared version only when the initial state exists and is empty", async () => {
    const r = await sharedReport(request(), "shared/meta.json");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ report: null });
  });
  it("publishes an immutable gzip and makes it readable by a second authenticated session", async () => {
    const r = await sharedReport(request("POST", "shared/data.gz"), "shared/data.gz");
    expect(r.status).toBe(200);
    const report = (await r.json()).report;
    cookie = `${COOKIE}=${(await makeSession("second-token", 1800, secret)).value}`;
    expect((await (await sharedReport(request(), "shared/meta.json")).json()).report.revision).toBe(report.revision);
    const read = await sharedReport(request("GET", "shared/data.gz?revision=" + report.revision), "shared/data.gz");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array(data));
    expect(read.headers.get("cache-control")).toContain("no-store");
  });
  it("blocks stale imports without overwriting the newer version", async () => {
    state.revision = version;
    const r = await sharedReport(request("POST", "shared/data.gz"), "shared/data.gz");
    expect(r.status).toBe(409);
    expect(uploads.size).toBe(0);
    expect(state.revision).toBe(version);
  });
  it("allows only one of two competing publications", async () => {
    const results = await Promise.all([sharedReport(request("POST", "shared/data.gz"), "shared/data.gz"), sharedReport(request("POST", "shared/data.gz"), "shared/data.gz")]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it.each(["metadata", "upload", "download"])("denies unauthenticated %s", async (mode) => {
    cookie = "";
    const r = await sharedReport(request(mode === "upload" ? "POST" : "GET", mode === "metadata" ? "shared/meta.json" : "shared/data.gz?revision=" + version), mode === "metadata" ? "shared/meta.json" : "shared/data.gz");
    expect(r.status).toBe(401);
    expect(uploads.size).toBe(0);
  });
  it("rejects unconfirmed or outside-domain identity", async () => {
    deny = true;
    expect((await sharedReport(request(), "shared/meta.json")).status).toBe(401);
  });
  it("rejects cross-site writes before uploading", async () => {
    const r = await sharedReport(request("POST", "shared/data.gz", { Origin: "https://evil.example" }), "shared/data.gz");
    expect(r.status).toBe(403); expect(uploads.size).toBe(0);
  });
  it("does not publish when storage fails", async () => {
    failStorage = true;
    expect((await sharedReport(request("POST", "shared/data.gz"), "shared/data.gz")).status).toBe(503);
    expect(state.revision).toBeNull();
  });
  it("does not change the current pointer if the publication transaction fails", async () => {
    failPublish = true;
    expect((await sharedReport(request("POST", "shared/data.gz"), "shared/data.gz")).status).toBe(503);
    expect(state.revision).toBeNull();
  });
  it("rejects corrupt gzip before uploading", async () => {
    const original = request("POST", "shared/data.gz");
    const bad = new Request(original.url, { method: "POST", headers: original.headers, body: "not gzip" });
    expect((await sharedReport(bad, "shared/data.gz")).status).toBe(400);
    expect(uploads.size).toBe(0);
  });
  it("fails closed without the server administrative key after authorizing the user", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await sharedReport(request(), "shared/meta.json");
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("MISSING_ADMIN_KEY");
    expect(backend.mock.calls).toHaveLength(1);
    expect(String(backend.mock.calls[0]![0])).toContain("/auth/v1/user");
  });
});

describe("comparison storage isolation", () => {
  function scoped(bank: string, role: string, method = "GET") {
    const r = request(method, "comparison/" + (method === "POST" ? "data.gz" : "meta.json") + `?bank=${bank}&relationship=${role}`);
    return sharedReport(r, method === "POST" ? "comparison/data.gz" : "comparison/meta.json");
  }
  it("keeps bank and relationship versions separate from the original shared base", async () => {
    expect((await scoped("happy", "sub", "POST")).status).toBe(200);
    expect((await scoped("icred", "sub", "POST")).status).toBe(200);
    expect((await scoped("happy", "indicado", "POST")).status).toBe(200);
    expect(comparisonState.size).toBe(3);
    expect(state.revision).toBeNull();
    expect((await (await scoped("c6", "sub")).json()).report).toBeNull();
    expect((await (await scoped("happy", "sub")).json()).report.revision).toBeTruthy();
  });
  it.each([["../escape", "sub"], ["happy", "admin"], ["unknown", "sub"]])("rejects unknown scope %s %s", async (bank, role) => {
    expect((await scoped(bank!, role!)).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
});

describe("sanitized diagnostics", () => {
  it.each([
    [404, "PGRST205", "MIGRATION_NOT_FOUND"],
    [403, "42501", "BACKEND_PERMISSION_DENIED"],
    [401, "PGRST301", "ADMIN_KEY_REJECTED"],
  ])("identifies metadata failure HTTP %s without exposing provider messages", async (status, upstream, expected) => {
    const original = backend.getMockImplementation()!;
    backend.mockImplementation((url: any, init: any) => String(url).includes("/rest/v1/")
      ? Promise.resolve(Response.json({ code: upstream, message: "SENSITIVE_TOKEN_AND_HEADER" }, { status: Number(status) }))
      : original(url, init));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await sharedReport(request(), "shared/meta.json");
      expect(r.status).toBe(503);
      const result = await r.json();
      expect(result.code).toBe(expected);
      expect(JSON.stringify(result)).not.toContain("SENSITIVE_TOKEN_AND_HEADER");
      expect(JSON.stringify(logger.mock.calls)).not.toContain("SENSITIVE_TOKEN_AND_HEADER");
      expect(JSON.stringify(logger.mock.calls)).not.toContain("admin-test");
      expect(JSON.stringify(logger.mock.calls)).toContain(upstream);
    } finally { logger.mockRestore(); }
  });
  it("distinguishes an absent initial row from an empty shared version", async () => {
    const original = backend.getMockImplementation()!;
    backend.mockImplementation((url: any, init: any) => String(url).includes("/rest/v1/pricing_shared_state")
      ? Promise.resolve(Response.json([])) : original(url, init));
    const r = await sharedReport(request(), "shared/meta.json");
    expect((await r.json()).code).toBe("SHARED_STATE_MISSING");
  });
});
