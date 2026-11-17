"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rotuloBoost } from "@/lib/catalogLabels";

export interface CatalogRow {
  id: string;
  mlb: string;
  title: string | null;
  sku: string | null;
  situacao: "preco" | "outro_motivo" | "erro";
  status_competicao: string | null;
  boosts_faltantes: string[] | null;
  orientacao: string | null;
  vencedor_item_id: string | null;
  vencedor_preco: number | null;
  preco_atual: number | null;
  preco_para_ganhar: number | null;
  preco_sugerido: number | null;
  margem_sem_incentivo_pct: number | null;
  margem_minima_pct: number | null;
  incentivo_necessario_valor: number | null;
  incentivo_necessario_pct: number | null;
  sku_referencia: string | null;
  promotion_type: string | null;
  preco_proposto: number | null;
  margem_campanha_pct: number | null;
  reducao_tarifa_valor: number | null;
  troca: boolean;
  gravavel: boolean;
  motivo: string;
  status: string;
}

export interface CatalogContagem {
  ganhando: number;
  preco: number;
  outro_motivo: number;
  erro: number;
}

const STATUS_COMPETICAO: Record<string, string> = {
  competing: "Perdendo",
  sharing_first_place: "Dividindo o 1º lugar",
  listed: "Só listado (não compete)",
  not_listed: "Fora da competição",
};

const STATUS_LINHA: Record<string, { texto: string; cls: string }> = {
  pendente: { texto: "Pendente", cls: "bg-blue-100 text-blue-800" },
  aplicada: { texto: "Aplicada", cls: "bg-green-100 text-green-800" },
  erro: { texto: "Erro", cls: "bg-red-100 text-red-800" },
};

type Aba = "preco" | "outro_motivo" | "erro";
type SortField = "mlb" | "precoAtual" | "precoGanhar" | "margem" | "incentivo";

const PAGE_SIZE = 50;

function money(v: number | null) {
  return v == null ? "-" : `R$ ${v.toFixed(2)}`;
}
function pct(v: number | null) {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}

function Th({
  field, children, sortField, sortDir, onSort, align = "right",
}: {
  field: SortField; children: React.ReactNode; sortField: SortField; sortDir: "asc" | "desc";
  onSort: (f: SortField) => void; align?: "left" | "right";
}) {
  return (
    <th
      className={`cursor-pointer select-none p-3 ${align === "right" ? "text-right" : "text-left"} hover:text-neutral-900`}
      onClick={() => onSort(field)}
    >
      {children} {sortField === field ? (sortDir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

function MlbCell({ r }: { r: CatalogRow }) {
  return (
    <td className="p-3">
      <div className="font-medium text-neutral-900">{r.mlb}</div>
      <div className="max-w-xs truncate text-xs text-neutral-500">{r.title ?? r.sku ?? ""}</div>
      {r.sku_referencia && <div className="text-xs text-amber-700">SKU ref.: {r.sku_referencia}</div>}
    </td>
  );
}

export default function CatalogoTable({ rows, contagem }: { rows: CatalogRow[]; contagem: CatalogContagem }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>(contagem.preco > 0 ? "preco" : contagem.outro_motivo > 0 ? "outro_motivo" : "erro");
  const [busca, setBusca] = useState("");
  const [soComCampanha, setSoComCampanha] = useState(false);
  const [sortField, setSortField] = useState<SortField>("incentivo");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ mlb: string; detalhe: string }[]>([]);

  const filtered = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.situacao !== aba) return false;
      if (b && !`${r.mlb} ${r.sku ?? ""} ${r.title ?? ""}`.toLowerCase().includes(b)) return false;
      if (aba === "preco" && soComCampanha && !r.promotion_type) return false;
      return true;
    });
  }, [rows, aba, busca, soComCampanha]);

  const sorted = useMemo(() => {
    const key = (r: CatalogRow): number | string => {
      switch (sortField) {
        case "precoAtual": return r.preco_atual ?? -Infinity;
        case "precoGanhar": return r.preco_sugerido ?? -Infinity;
        case "margem": return r.margem_sem_incentivo_pct ?? -Infinity;
        case "incentivo": return r.incentivo_necessario_valor ?? Infinity;
        default: return r.mlb;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);
  const selecionaveis = sorted.filter((r) => r.gravavel && r.status === "pendente");
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every((r) => selected.has(r.id));

  function sortBy(f: SortField) {
    if (sortField === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(f);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of selecionaveis) {
        if (todosSelecionados) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  async function handleApply() {
    setApplying(true);
    setResult(null);
    setFailures([]);
    const mlbById = new Map(rows.map((r) => [r.id, r.mlb]));
    let remaining = [...selected];
    let ok = 0;
    const falhas: { mlb: string; detalhe: string }[] = [];
    try {
      for (let hop = 0; hop < 100 && remaining.length > 0; hop++) {
        const resp = await fetch("/api/catalogo/aplicar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisionIds: remaining, confirmacao: confirmText }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setResult(`Erro: ${data.error} (${ok} aplicado(s) antes do erro)`);
          break;
        }
        for (const r of data.results as { id: string; mlb: string; ok: boolean; detalhe: string }[]) {
          if (r.ok) ok++;
          else falhas.push({ mlb: mlbById.get(r.id) ?? r.mlb, detalhe: r.detalhe });
        }
        remaining = data.remainingIds ?? [];
        if (data.done) {
          setResult(falhas.length > 0 ? `Aplicado: ${ok} com sucesso, ${falhas.length} com erro.` : `Aplicado: ${ok} com sucesso.`);
          setSelected(new Set());
          break;
        }
      }
    } catch (e) {
      setResult(`Erro: ${e instanceof Error ? e.message : String(e)} (${ok} aplicado(s) antes do erro)`);
    } finally {
      setFailures(falhas);
      setApplying(false);
      setConfirming(false);
      setConfirmText("");
      router.refresh();
    }
  }

  const abas: { id: Aba; label: string; n: number }[] = [
    { id: "preco", label: "Perdendo por preço", n: contagem.preco },
    { id: "outro_motivo", label: "Perdendo por outro motivo", n: contagem.outro_motivo },
    { id: "erro", label: "Erros na análise", n: contagem.erro },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">Ganhando: {contagem.ganhando}</span>
        <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">Perdendo por preço: {contagem.preco}</span>
        <span className="rounded-full bg-orange-100 px-3 py-1 font-medium text-orange-800">Outro motivo: {contagem.outro_motivo}</span>
        {contagem.erro > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800">Erros: {contagem.erro}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {abas.filter((a) => a.n > 0 || a.id !== "erro").map((a) => (
          <button
            key={a.id}
            onClick={() => { setAba(a.id); setPage(1); setSelected(new Set()); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              aba === a.id ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {a.label} ({a.n})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">Buscar MLB / SKU / título</label>
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1); }}
            className="w-56 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        {aba === "preco" && (
          <label className="flex items-center gap-2 pb-1.5 text-sm text-neutral-600">
            <input type="checkbox" checked={soComCampanha} onChange={(e) => { setSoComCampanha(e.target.checked); setPage(1); }} />
            Só com campanha sugerida
          </label>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">Nada nesta aba.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          {aba === "preco" && (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="p-3">
                    {selecionaveis.length > 0 && <input type="checkbox" checked={todosSelecionados} onChange={toggleTodos} />}
                  </th>
                  <Th field="mlb" align="left" sortField={sortField} sortDir={sortDir} onSort={sortBy}>MLB / Título</Th>
                  <Th field="precoAtual" sortField={sortField} sortDir={sortDir} onSort={sortBy}>Preço atual</Th>
                  <th className="p-3 text-right">Vencedor</th>
                  <Th field="precoGanhar" sortField={sortField} sortDir={sortDir} onSort={sortBy}>Preço p/ ganhar</Th>
                  <Th field="margem" sortField={sortField} sortDir={sortDir} onSort={sortBy}>Margem s/ incentivo</Th>
                  <Th field="incentivo" sortField={sortField} sortDir={sortDir} onSort={sortBy}>Incentivo necessário</Th>
                  <th className="p-3">Campanha sugerida</th>
                  <th className="p-3">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const abaixo = r.margem_sem_incentivo_pct != null && r.margem_minima_pct != null && r.margem_sem_incentivo_pct < r.margem_minima_pct;
                  return (
                    <tr key={r.id} className="border-t border-neutral-100 align-top">
                      <td className="p-3">
                        {r.gravavel && r.status === "pendente" && (
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        )}
                      </td>
                      <MlbCell r={r} />
                      <td className="p-3 text-right text-neutral-500">{money(r.preco_atual)}</td>
                      <td className="p-3 text-right text-neutral-500">{money(r.vencedor_preco)}</td>
                      <td className="p-3 text-right">
                        <div className="font-medium">{money(r.preco_sugerido)}</div>
                        <div className="text-xs text-neutral-400" title="Valor cru devolvido pelo ML, antes do arredondamento ,90/,49 pra baixo">
                          ML: {money(r.preco_para_ganhar)}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div className={abaixo ? "text-red-700" : "text-green-700"}>{pct(r.margem_sem_incentivo_pct)}</div>
                        <div className="text-xs text-neutral-400">mín. {pct(r.margem_minima_pct)}</div>
                      </td>
                      <td className="p-3 text-right">
                        {r.incentivo_necessario_valor != null && r.incentivo_necessario_valor > 0 ? (
                          <>
                            <div>{money(r.incentivo_necessario_valor)}</div>
                            <div className="text-xs text-neutral-400">{pct(r.incentivo_necessario_pct)} do preço</div>
                          </>
                        ) : r.incentivo_necessario_valor != null ? (
                          <span className="text-green-700">Nenhum</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-3">
                        {r.promotion_type ? (
                          <div className="space-y-0.5">
                            <div className="font-medium text-neutral-900">
                              {r.troca ? "Atualizar " : ""}{r.promotion_type}
                            </div>
                            <div className="text-xs text-neutral-600">
                              {money(r.preco_proposto)} · margem {pct(r.margem_campanha_pct)}
                            </div>
                            {r.reducao_tarifa_valor != null && (
                              <div className="text-xs text-green-700">incentivo ML {money(r.reducao_tarifa_valor)}</div>
                            )}
                            {STATUS_LINHA[r.status] && (
                              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LINHA[r.status].cls}`}>
                                {STATUS_LINHA[r.status].texto}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400">Nenhuma viável</span>
                        )}
                      </td>
                      <td className="max-w-xs p-3 text-xs text-neutral-600">
                        {r.motivo}
                        {r.orientacao && <div className="mt-1 text-amber-700">{r.orientacao}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {aba === "outro_motivo" && (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <Th field="mlb" align="left" sortField={sortField} sortDir={sortDir} onSort={sortBy}>MLB / Título</Th>
                  <th className="p-3">Situação</th>
                  <Th field="precoAtual" sortField={sortField} sortDir={sortDir} onSort={sortBy}>Preço atual</Th>
                  <th className="p-3 text-right">Vencedor</th>
                  <th className="p-3">Falta em relação ao vencedor</th>
                  <th className="p-3">O que fazer</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100 align-top">
                    <MlbCell r={r} />
                    <td className="p-3 text-xs">{STATUS_COMPETICAO[r.status_competicao ?? ""] ?? r.status_competicao ?? "-"}</td>
                    <td className="p-3 text-right text-neutral-500">{money(r.preco_atual)}</td>
                    <td className="p-3 text-right text-neutral-500">{money(r.vencedor_preco)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.boosts_faltantes ?? []).map((b) => (
                          <span key={b} className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">{rotuloBoost(b)}</span>
                        ))}
                        {(r.boosts_faltantes ?? []).length === 0 && <span className="text-xs text-neutral-400">-</span>}
                      </div>
                    </td>
                    <td className="max-w-md p-3 text-xs text-neutral-700">{r.orientacao ?? r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {aba === "erro" && (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="p-3">MLB / Título</th>
                  <th className="p-3">Erro</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100 align-top">
                    <MlbCell r={r} />
                    <td className="p-3 text-xs text-red-700">{r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-neutral-100 p-3 text-sm">
              <button disabled={pageClamped <= 1} onClick={() => setPage((p) => p - 1)} className="text-neutral-600 hover:underline disabled:opacity-30">
                ← Anterior
              </button>
              <span className="text-neutral-500">{pageClamped} / {totalPages}</span>
              <button disabled={pageClamped >= totalPages} onClick={() => setPage((p) => p + 1)} className="text-neutral-600 hover:underline disabled:opacity-30">
                Próxima →
              </button>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Aplicar campanhas selecionadas ({selected.size})
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-neutral-500 hover:underline">
            Limpar seleção
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
          <p>{result}</p>
          {failures.map((f, i) => (
            <p key={`${f.mlb}-${i}`} className="text-xs text-red-700">
              <b>{f.mlb}</b>: {f.detalhe}
            </p>
          ))}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-neutral-900">Confirmar gravação real</h3>
            <p className="text-sm text-neutral-600">
              Isso vai gravar {selected.size} adesão(ões)/atualização(ões) de campanha na sua conta REAL do
              Mercado Livre pra tentar ganhar o catálogo — preços promocionais são um compromisso comercial.
              Digite <b>CONFIRMAR</b> para prosseguir.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              placeholder="CONFIRMAR"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setConfirming(false); setConfirmText(""); }}
                disabled={applying}
                className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                disabled={confirmText !== "CONFIRMAR" || applying}
                onClick={handleApply}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {applying ? "Gravando..." : "Gravar de verdade"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
