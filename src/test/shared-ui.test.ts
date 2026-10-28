import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(process.cwd() + "/package.json")("jsdom");
import { afterEach, describe, expect, it, vi } from "vitest";

let page: any;
afterEach(() => page?.window.close());
function setup(load = true) {
  const directory = process.cwd() + "/src/server/private-site/";
  page = new JSDOM(readFileSync(directory + "index.html", "utf8"), { url: "https://portal.example/app/", runScripts: "outside-only" });
  const win = page.window as any;
  const workers: any[] = [];
  const intervals: any[] = [];
  win.Worker = class {
    onmessage: any;
    constructor() { workers.push(this); }
    postMessage = vi.fn();
    terminate = vi.fn();
  };
  win.setInterval = (callback: any, delay: number) => { intervals.push({ callback, delay }); return 1; };
  win.fetch = vi.fn();
  win.eval(readFileSync(directory + "engine.js", "utf8"));
  win.eval(readFileSync(directory + "app.js", "utf8"));
  const result = win.Comissoes.prepare({ headers: ["Id Regra", "Credenciador", "Descricao Regra", "Prazo De", "Prazo Até", "Tipo Comissao", "Base", "Valor", "Sigla Convenio", "Tipo Proposta", "Data Inicio"], rows: [[1, "Banco teste", "Sem carência", 1, 120, "Flat", "Valor Liquido", 0.1, "INSS", "Novo", "2026-10-27"]] });
  const report = { revision: "version-a", source: "Primeira.xlsx", updatedAt: "2026-10-27T12:00:00Z" };
  if (load) workers[0].onmessage({ data: { result, report } });
  return { win, workers, intervals, result, report };
}
describe("shared base interface", () => {
  it("does not claim a prior base was preserved when initial loading failed", () => {
    const { win, workers } = setup(false);
    workers[0].onmessage({ data: { error: "MISSING_ADMIN_KEY" } });
    const status = win.document.getElementById("status").textContent;
    expect(status).toContain("Nenhuma base foi carregada");
    expect(status).not.toContain("base anterior foi preservada");
  });
  it("loads the shared base at startup and offers manual refresh", () => {
    const { win, workers, intervals } = setup();
    expect(workers[0].postMessage).toHaveBeenCalledWith({ action: "seed" });
    expect(win.document.getElementById("status").textContent).toContain("base compartilhada");
    win.document.getElementById("refresh-shared").click();
    expect(workers).toHaveLength(2);
    expect(intervals[0].delay).toBe(60000);
  });
  it("refreshes only on a changed version and preserves selected filters", async () => {
    const { win, workers, intervals, result, report } = setup();
    win.document.getElementById("amount").value = "25000";
    Object.defineProperty(win.document, "hidden", { value: false, configurable: true });
    win.fetch.mockResolvedValue({ ok: true, json: async () => ({ report }) });
    await intervals[0].callback();
    expect(workers).toHaveLength(1);
    const next = { ...report, revision: "version-b", source: "Segunda.xlsx" };
    win.fetch.mockResolvedValue({ ok: true, json: async () => ({ report: next }) });
    await intervals[0].callback();
    expect(workers).toHaveLength(2);
    workers[1].onmessage({ data: { result, report: next } });
    expect(win.document.getElementById("amount").value).toBe("25000");
    expect(win.document.getElementById("status").textContent).toContain("Segunda.xlsx");
  });
  it("keeps the previous base visible if refreshing fails", () => {
    const { win, workers } = setup();
    win.document.getElementById("refresh-shared").click();
    workers[1].onmessage({ data: { error: "Storage indisponível" } });
    expect(win.document.getElementById("status").textContent).toContain("base anterior foi preservada");
    expect(win.document.getElementById("refresh-shared").disabled).toBe(false);
    expect(win.document.getElementById("chart").textContent).toContain("Banco teste");
  });
});
