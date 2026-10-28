import { baseHeaders, config, confirmedUser, json, sessionToken } from "@/server/portal-session";

const MAX_COMPRESSED = 8 * 1024 * 1024;
const MAX_EXPANDED = 48 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const comparisonBanks = new Set(["happy", "icred", "c6", "bmg", "facta", "amigoz", "digio", "acredto", "daycoval", "pan", "quali", "nbc", "presenca", "safra", "futuro", "meucashcard", "neon"]);
type Scope = { bank: string; relationship: string } | null;

class ReportError extends Error {
  constructor(public code: string, message: string, public stage: string, public upstreamStatus?: number, public upstreamCode?: string) {
    super(message);
  }
}

async function providerFailure(response: Response, stage: string): Promise<never> {
  const body = await response.json().catch(() => ({}));
  // Never forward provider messages: they can contain internal details or request data.
  const rawCode = typeof body?.code === "string" ? body.code : "";
  const code = /^[A-Z0-9_]{1,32}$/.test(rawCode) ? rawCode : undefined;
  if (response.status === 401) throw new ReportError("ADMIN_KEY_REJECTED", "A credencial administrativa foi recusada pelo backend configurado. Confira se a URL e a chave pertencem ao mesmo projeto.", stage, response.status, code);
  if (["PGRST205", "42P01", "PGRST202"].includes(code ?? "")) throw new ReportError("MIGRATION_NOT_FOUND", "A tabela ou função desta atualização não foi localizada no backend configurado. Confira a execução da migração no mesmo projeto usado pelo aplicativo.", stage, response.status, code);
  if (response.status === 403 || code === "42501") throw new ReportError("BACKEND_PERMISSION_DENIED", "O backend recusou a permissão da credencial administrativa nesta operação. Preserve RLS e confira a credencial e os privilégios do servidor.", stage, response.status, code);
  throw new ReportError("BACKEND_REQUEST_FAILED", `O backend falhou na etapa ${stage} (HTTP ${response.status}${code ? ", " + code : ""}). A base anterior foi preservada.`, stage, response.status, code);
}

function adminConfig() {
  const cfg = config();
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key?.trim()) throw new ReportError("MISSING_ADMIN_KEY", "SUPABASE_SERVICE_ROLE_KEY não está disponível no servidor. Confira o segredo no Lovable Cloud; não o coloque no código ou no navegador.", "configuration");
  return { ...cfg, admin: key };
}
type Cfg = ReturnType<typeof adminConfig>;
function adminHeaders(cfg: Cfg) {
  return { apikey: cfg.admin, ...(cfg.admin.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${cfg.admin}` }) };
}
async function api(cfg: Cfg, path: string, init?: RequestInit) {
  try { return await fetch(cfg.url + path, {
    ...init, headers: { ...adminHeaders(cfg), ...init?.headers }, signal: AbortSignal.timeout(30000),
  }); } catch {
    throw new ReportError("BACKEND_UNREACHABLE", "Não foi possível conectar ao backend dentro do prazo. Confira a URL e a disponibilidade do serviço.", "connection");
  }
}
async function metadata(cfg: Cfg, scope: Scope = null) {
  const table = scope ? `/rest/v1/pricing_comparison_state?bank_key=eq.${scope.bank}&relationship=eq.${scope.relationship}&select=revision,source_name,record_count,updated_at` : "/rest/v1/pricing_shared_state?id=eq.1&select=revision,source_name,record_count,updated_at";
  const r = await api(cfg, table);
  if (!r.ok) await providerFailure(r, scope ? "comparison_metadata" : "shared_metadata");
  const rows = await r.json();
  if (scope && Array.isArray(rows) && rows.length === 0) return null;
  if (!Array.isArray(rows) || rows.length !== 1) throw new ReportError("SHARED_STATE_MISSING", "A consulta respondeu, mas o registro inicial da base compartilhada não foi encontrado. Confira a execução integral da migração neste projeto.", "shared_metadata");
  const row = rows[0];
  return row.revision ? { revision: row.revision, source: row.source_name, records: row.record_count, updatedAt: row.updated_at } : null;
}
async function readLimited(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_COMPRESSED) { await reader.cancel(); throw new Error("size"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Auth is checked for metadata, downloads and uploads. No public bucket or signed URLs. */
export async function sharedReport(request: Request, name: string) {
  try {
    let scope: Scope = null;
    if (name.startsWith("comparison/")) {
      const url = new URL(request.url);
      const bank = url.searchParams.get("bank") ?? "";
      const relationship = url.searchParams.get("relationship") ?? "";
      if (!comparisonBanks.has(bank) || !["sub", "indicado"].includes(relationship)) return json({ error: "Banco ou modalidade inválida." }, 400);
      scope = { bank, relationship };
      name = name.replace(/^comparison\//, "shared/");
    }
    let authCfg: ReturnType<typeof config>;
    try { authCfg = config(); } catch {
      throw new ReportError("AUTH_CONFIGURATION_MISSING", "A configuração de autenticação do servidor está incompleta. Confira SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SESSION_SECRET.", "authentication");
    }
    const user = await confirmedUser(await sessionToken(request.headers.get("cookie"), authCfg.secret), authCfg);
    if (!user) return json({ error: "Autenticação corporativa obrigatória." }, 401);
    const cfg = adminConfig();
    if (request.method === "GET" && name === "shared/meta.json") return json({ report: await metadata(cfg, scope) });
    if (request.method === "GET" && name === "shared/data.gz") {
      const revision = new URL(request.url).searchParams.get("revision");
      if (!revision || !uuid.test(revision)) return json({ error: "Versão inválida." }, 400);
      const path = scope ? `comparison/${scope.bank}/${scope.relationship}/${revision}.json.gz` : `${revision}.json.gz`;
      const r = await api(cfg, `/storage/v1/object/authenticated/pricing-reports/${path}`);
      if (!r.ok) await providerFailure(r, "storage_read");
      return new Response(r.body, { headers: { ...baseHeaders, "Content-Type": "application/gzip" } });
    }
    if (request.method !== "POST" || name !== "shared/data.gz") return json({ error: "Operação não permitida." }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origem não permitida." }, 403);
    if (request.headers.get("content-type") !== "application/gzip") return json({ error: "Formato inválido." }, 415);
    const expected = request.headers.get("x-report-version");
    if (expected !== "initial" && (!expected || !uuid.test(expected))) return json({ error: "Recarregue a base antes de importar." }, 400);
    const count = Number(request.headers.get("x-report-count"));
    const source = decodeURIComponent(request.headers.get("x-report-source") ?? "").trim();
    if (!Number.isInteger(count) || count < 1 || count > 200000 || !source || source.length > 240) return json({ error: "Metadados inválidos." }, 400);
    const current = await metadata(cfg, scope);
    if ((current?.revision ?? "initial") !== expected) return json({ error: "Outra pessoa atualizou a base. Atualize o painel e importe novamente." }, 409);
    let bytes: Uint8Array;
    try {
      bytes = await readLimited(request);
      // Validate gzip integrity and expanded size without keeping the decompressed Excel data in memory.
      const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream("gzip"));
      const reader = stream.getReader();
      let expanded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        expanded += value.byteLength;
        if (expanded > MAX_EXPANDED) { await reader.cancel(); throw new Error("size"); }
      }
      if (!expanded) throw new Error("empty");
    } catch { return json({ error: "Arquivo inválido ou acima do limite (8 MB compactados / 48 MB de dados)." }, 400); }
    const revision = crypto.randomUUID();
    const path = scope ? `comparison/${scope.bank}/${scope.relationship}/${revision}.json.gz` : `${revision}.json.gz`;
    const upload = await api(cfg, `/storage/v1/object/pricing-reports/${path}`, {
      method: "POST", headers: { "Content-Type": "application/gzip", "x-upsert": "false" }, body: bytes as BodyInit,
    });
    if (!upload.ok) await providerFailure(upload, "storage_upload");
    const publish = await api(cfg, scope ? "/rest/v1/rpc/publish_pricing_comparison" : "/rest/v1/rpc/publish_pricing_report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_expected: expected === "initial" ? null : expected, p_revision: revision, p_source: source, p_count: count, p_user: user.id, ...(scope ? { p_bank: scope.bank, p_relationship: scope.relationship } : {}) }),
    });
    if (!publish.ok) {
      const error = await publish.clone().json().catch(() => ({}));
      if (error.code === "40001") return json({ error: "Outra pessoa atualizou a base. Recarregue antes de importar." }, 409);
      await providerFailure(publish, "publication");
    }
    return json({ report: await publish.json() });
  } catch (error) {
    const safe = error instanceof ReportError ? error : new ReportError("UNEXPECTED_BACKEND_ERROR", "Não foi possível concluir a consulta. Consulte o código deste diagnóstico nos logs do servidor.", "unknown");
    console.error(JSON.stringify({ event: "pricing.shared_report.error", code: safe.code, stage: safe.stage, upstreamStatus: safe.upstreamStatus, upstreamCode: safe.upstreamCode }));
    return json({ error: `Base compartilhada indisponível [${safe.code}]: ${safe.message}`, code: safe.code, stage: safe.stage }, 503);
  }
}
