"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface DecisionRow {
  id: string;
  mlb: string;
  promotion_id: string | null;
  promotion_type: string;
  preco_proposto: number | null;
  preco_original: number | null;
  margem_calculada_pct: number | null;
  desconto_consumidor_pct: number | null;
  ml_participacao_pct: number | null;
  ml_participacao_fonte: string | null;
  reducao_tarifa: boolean;
  reducao_tarifa_pct: number | null;
  reducao_tarifa_valor: number | null;
  reducao_tarifa_fonte: string | null;
  troca: boolean;
  campanha_anterior_tipo: string | null;
  campanha_anterior_margem_pct: number | null;
  campanha_anterior_score: number | null;
  recomendacao: string | null;
  sku_referencia: string | null;
  score: number | null;
  gravavel: boolean;
  motivo: string;
  status: string;
  created_at: string;
  title: string | null;
  sku: string | null;
}

const RECOMENDACAO_LABEL: Record<string, string> = {
  diminuir_preco: "Diminuir preço",
  aumentar_preco: "Aumentar preço",
  mantida: "Mantida",
  tolerancia: "Dentro da tolerância",
  rejeitada: "Rejeitada",
  superada: "Superada",
};

const RECOMENDACAO_COLOR: Record<string, string> = {
  diminuir_preco: "bg-green-100 text-green-800",
  aumentar_preco: "bg-amber-100 text-amber-800",
  mantida: "bg-neutral-100 text-neutral-600",
  tolerancia: "bg-orange-100 text-orange-800",
};

function fmtPct(v: number | null) {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}
function fmtMoney(v: number | null) {
  return v == null ? "-" : `R$ ${v.toFixed(2)}`;
}
function average(nums: number[]): number | null {
  const valid = nums.filter((n) => Number.isFinite(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

type SortField = "mlb" | "margem" | "score" | "preco" | "desconto";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;
const BATCH_CONFIRM_THRESHOLD = 100;

export default function DecisionTable({
  rows,
  variant = "normal",
  title,
  description,
}: {
  rows: DecisionRow[];
  variant?: "normal" | "tolerancia";
  title: string;
  description: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [recFiltro, setRecFiltro] = useState<Set<string>>(new Set());
  const [tipoFiltro, setTipoFiltro] = useState<Set<string>>(new Set());
  const [soIncentivoMl, setSoIncentivoMl] = useState(false);
  const [margemMin, setMargemMin] = useState("");
  const [margemMax, setMargemMax] = useState("");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirmCount, setConfirmCount] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ mlb: string; title: string | null; promotion_type: string; detalhe: string }[]>([]);
  const [showFailures, setShowFailures] = useState(false);

  const recomendacoesDisponiveis = useMemo(
    () => [...new Set(rows.map((r) => r.recomendacao).filter((r): r is string => !!r))],
    [rows],
  );
  const tiposDisponiveis = useMemo(() => [...new Set(rows.map((r) => r.promotion_type))], [rows]);

  const filtered = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (buscaLower) {
        const alvo = `${r.mlb} ${r.sku ?? ""} ${r.title ?? ""}`.toLowerCase();
        if (!alvo.includes(buscaLower)) return false;
      }
      if (recFiltro.size > 0 && !recFiltro.has(r.recomendacao ?? "")) return false;
      if (tipoFiltro.size > 0 && !tipoFiltro.has(r.promotion_type)) return false;
      if (soIncentivoMl && !r.reducao_tarifa) return false;
      if (margemMin && (r.margem_calculada_pct ?? -Infinity) < Number(margemMin)) return false;
      if (margemMax && (r.margem_calculada_pct ?? Infinity) > Number(margemMax)) return false;
      if (scoreMin && (r.score ?? -Infinity) < Number(scoreMin)) return false;
      if (scoreMax && (r.score ?? Infinity) > Number(scoreMax)) return false;
      return true;
    });
  }, [rows, busca, recFiltro, tipoFiltro, soIncentivoMl, margemMin, margemMax, scoreMin, scoreMax]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const key = (r: DecisionRow): number | string => {
      switch (sortField) {
        case "margem": return r.margem_calculada_pct ?? -Infinity;
        case "score": return r.score ?? -Infinity;
        case "preco": return r.preco_proposto ?? -Infinity;
        case "desconto": return r.desconto_consumidor_pct ?? -Infinity;
        default: return r.mlb;
      }
    };
    arr.sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const filteredGravaveis = useMemo(() => sorted.filter((r) => r.gravavel), [sorted]);
  const allFilteredSelected = filteredGravaveis.length > 0 && filteredGravaveis.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filteredGravaveis) next.delete(r.id);
      } else {
        for (const r of filteredGravaveis) next.add(r.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function sortBy(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  function toggleFromSet(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
    setPage(1);
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const needsReinforcedConfirm = selectedRows.length > BATCH_CONFIRM_THRESHOLD;
  const avgMargem = average(selectedRows.map((r) => r.margem_calculada_pct ?? NaN));
  const avgDesconto = average(selectedRows.map((r) => r.desconto_consumidor_pct ?? NaN));
  const comAnterior = selectedRows.filter((r) => r.campanha_anterior_margem_pct != null);
  const avgDeltaMargem = comAnterior.length
    ? average(comAnterior.map((r) => (r.margem_calculada_pct ?? 0) - (r.campanha_anterior_margem_pct ?? 0)))
    : null;

  async function handleApply() {
    setApplying(true);
    setResult(null);
    setFailures([]);
    setShowFailures(false);
    const total = selectedRows.length;
    const rowById = new Map(rows.map((r) => [r.id, r]));
    let remaining = [...selected];
    let okCount = 0;
    let failCount = 0;
    const allFailures: { mlb: string; title: string | null; promotion_type: string; detalhe: string }[] = [];
    setApplyProgress({ done: 0, total });
    try {
      for (let hop = 0; hop < 200 && remaining.length > 0; hop++) {
        const resp = await fetch("/api/aplicar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisionIds: remaining, confirmacao: confirmText }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setResult(`Erro: ${data.error} (${okCount} aplicados com sucesso antes do erro)`);
          break;
        }
        for (const r of data.results as { id: string; mlb: string; ok: boolean; detalhe: string }[]) {
          if (r.ok) okCount++;
          else {
            failCount++;
            allFailures.push({
              mlb: r.mlb,
              title: rowById.get(r.id)?.title ?? null,
              promotion_type: rowById.get(r.id)?.promotion_type ?? "-",
              detalhe: r.detalhe,
            });
          }
        }
        setFailures([...allFailures]);
        remaining = data.remainingIds ?? [];
        setApplyProgress({ done: total - remaining.length, total });
        if (data.done) {
          setResult(
            failCount > 0
              ? `Aplicado: ${okCount} com sucesso, ${failCount} com erro/pulado — detalhes abaixo.`
              : `Aplicado: ${okCount} com sucesso.`,
          );
          setSelected(new Set());
          break;
        }
      }
    } catch (e) {
      setResult(`Erro: ${e instanceof Error ? e.message : String(e)} (${okCount} aplicados com sucesso antes do erro)`);
    } finally {
      setApplying(false);
      setApplyProgress(null);
      setConfirming(false);
      setConfirmText("");
      setConfirmCount("");
      router.refresh();
    }
  }

  function SortHeader({ field, children, align = "right" }: { field: SortField; children: React.ReactNode; align?: "left" | "right" }) {
    const active = sortField === field;
    return (
      <th
        className={`cursor-pointer select-none p-3 ${align === "right" ? "text-right" : "text-left"} hover:text-neutral-900`}
        onClick={() => sortBy(field)}
      >
        {children} {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
      </th>
    );
  }

  if (rows.length === 0) return null;

  const bannerClass = variant === "tolerancia" ? "border-orange-200 bg-orange-50" : "border-neutral-200 bg-white";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">Buscar MLB / SKU / título</label>
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1); }}
            className="w-56 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">Margem % (min–max)</label>
          <div className="flex items-center gap-1">
            <input value={margemMin} onChange={(e) => { setMargemMin(e.target.value); setPage(1); }} type="number" className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <span className="text-neutral-400">–</span>
            <input value={margemMax} onChange={(e) => { setMargemMax(e.target.value); setPage(1); }} type="number" className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">Score (min–max)</label>
          <div className="flex items-center gap-1">
            <input value={scoreMin} onChange={(e) => { setScoreMin(e.target.value); setPage(1); }} type="number" className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <span className="text-neutral-400">–</span>
            <input value={scoreMax} onChange={(e) => { setScoreMax(e.target.value); setPage(1); }} type="number" className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-neutral-600">
          <input type="checkbox" checked={soIncentivoMl} onChange={(e) => { setSoIncentivoMl(e.target.checked); setPage(1); }} />
          Só com incentivo do ML
        </label>
      </div>

      {recomendacoesDisponiveis.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Recomendação:</span>
          {recomendacoesDisponiveis.map((rec) => (
            <button
              key={rec}
              onClick={() => toggleFromSet(recFiltro, setRecFiltro, rec)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                recFiltro.has(rec) ? "bg-neutral-900 text-white" : (RECOMENDACAO_COLOR[rec] ?? "bg-neutral-100 text-neutral-600")
              }`}
            >
              {RECOMENDACAO_LABEL[rec] ?? rec}
            </button>
          ))}
        </div>
      )}

      {tiposDisponiveis.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Tipo de campanha:</span>
          {tiposDisponiveis.map((tipo) => (
            <button
              key={tipo}
              onClick={() => toggleFromSet(tipoFiltro, setTipoFiltro, tipo)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                tipoFiltro.has(tipo) ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {tipo}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Mostrando {paged.length} de {sorted.length} filtrado(s) (de {rows.length} no total) — página{" "}
        {pageClamped}/{totalPages}
      </p>

      <div className={`overflow-x-auto rounded-lg border ${bannerClass}`}>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="p-3">
                <input type="checkbox" checked={allFilteredSelected} onChange={selectAllFiltered} />
              </th>
              <SortHeader field="mlb" align="left">MLB / Título</SortHeader>
              <th className="p-3">Campanha</th>
              <th className="p-3">Recomendação</th>
              <SortHeader field="preco">Preço</SortHeader>
              <SortHeader field="desconto">Desconto</SortHeader>
              <SortHeader field="margem">Margem</SortHeader>
              <th className="p-3 text-right">Incentivo ML</th>
              <SortHeader field="score">Score</SortHeader>
              <th className="p-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 align-top">
                <td className="p-3">
                  {r.gravavel && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                </td>
                <td className="p-3">
                  <div className="font-medium text-neutral-900">{r.mlb}</div>
                  <div className="max-w-xs truncate text-xs text-neutral-500">{r.title ?? r.sku ?? ""}</div>
                  {r.sku_referencia && <div className="text-xs text-amber-700">SKU ref.: {r.sku_referencia}</div>}
                  {r.troca && (
                    <div className="text-xs font-medium text-blue-700">
                      🔄 {r.campanha_anterior_tipo} → {r.promotion_type}
                    </div>
                  )}
                </td>
                <td className="p-3">{r.promotion_type}</td>
                <td className="p-3">
                  {r.recomendacao && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RECOMENDACAO_COLOR[r.recomendacao] ?? "bg-neutral-100 text-neutral-600"}`}>
                      {RECOMENDACAO_LABEL[r.recomendacao] ?? r.recomendacao}
                    </span>
                  )}
                </td>
                <td className="p-3 text-right">{fmtMoney(r.preco_proposto)}</td>
                <td className="p-3 text-right">{fmtPct(r.desconto_consumidor_pct)}</td>
                <td className="p-3 text-right">{fmtPct(r.margem_calculada_pct)}</td>
                <td className="p-3 text-right">
                  {r.reducao_tarifa ? (
                    r.reducao_tarifa_fonte === "estimada_meli_percentage" ? (
                      <span className="text-amber-700" title="Estimado a partir de meli_percentage (gordura de 1,5pp) — API não confirma este valor.">
                        ~{fmtMoney(r.reducao_tarifa_valor)}
                      </span>
                    ) : (
                      <span className="text-green-700" title="Valor exato confirmado pela API (discount_meli_boost_amount).">
                        {fmtMoney(r.reducao_tarifa_valor)}
                      </span>
                    )
                  ) : (
                    <span className="text-neutral-400">-</span>
                  )}
                </td>
                <td className="p-3 text-right">{r.score?.toFixed(1) ?? "-"}</td>
                <td className="max-w-xs p-3 text-xs text-neutral-600">{r.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {filteredGravaveis.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={selectAllFiltered} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            {allFilteredSelected ? "Desmarcar filtrados" : `Selecionar todos os filtrados (${filteredGravaveis.length})`}
          </button>
          {selected.size > 0 && (
            <button onClick={clearSelection} className="text-sm text-neutral-500 hover:underline">
              Limpar seleção ({selected.size})
            </button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-700">
            <b>{selectedRows.length}</b> selecionado(s) — margem média {fmtPct(avgMargem)}, desconto médio{" "}
            {fmtPct(avgDesconto)}
            {avgDeltaMargem != null && (
              <>, variação média de margem {avgDeltaMargem >= 0 ? "+" : ""}{avgDeltaMargem.toFixed(1)}pp</>
            )}
            .
          </p>
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Aplicar selecionados ({selected.size})
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-700">{result}</p>
          {failures.length > 0 && (
            <div>
              <button
                onClick={() => setShowFailures((v) => !v)}
                className="text-xs font-medium text-neutral-500 hover:underline"
              >
                {showFailures ? "Ocultar detalhes dos erros" : `Ver detalhes dos erros (${failures.length})`}
              </button>
              {showFailures && (
                <div className="mt-2 max-h-80 overflow-auto rounded-md border border-neutral-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-neutral-50 text-left uppercase text-neutral-500">
                      <tr>
                        <th className="p-2">MLB</th>
                        <th className="p-2">Campanha</th>
                        <th className="p-2">Detalhe do erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map((f, i) => (
                        <tr key={`${f.mlb}-${i}`} className="border-t border-neutral-100 align-top">
                          <td className="p-2 font-medium text-neutral-900">
                            {f.mlb}
                            {f.title && <div className="font-normal text-neutral-400">{f.title}</div>}
                          </td>
                          <td className="p-2">{f.promotion_type}</td>
                          <td className="max-w-md p-2 text-neutral-600">{f.detalhe}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-neutral-900">Confirmar gravação real</h3>
            <p className="text-sm text-neutral-600">
              Isso vai gravar {selectedRows.length} adesão(ões)/atualização(ões) na sua conta REAL do
              Mercado Livre — preços promocionais são um compromisso comercial.
              {variant === "tolerancia" && (
                <> Estes itens ficam <b>abaixo do piso de margem</b> configurado (dentro da tolerância) — confirme que você revisou isso.</>
              )}{" "}
              Digite <b>CONFIRMAR</b> para prosseguir.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              placeholder="CONFIRMAR"
            />
            {needsReinforcedConfirm && (
              <div className="space-y-1 rounded-md bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  Lote grande ({selectedRows.length} itens) — digite o número exato pra confirmar que
                  revisou a quantidade:
                </p>
                <input
                  value={confirmCount}
                  onChange={(e) => setConfirmCount(e.target.value)}
                  type="number"
                  className="w-full rounded-md border border-amber-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                  placeholder={String(selectedRows.length)}
                />
              </div>
            )}
            {applying && applyProgress && (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full bg-red-500 transition-all"
                    style={{ width: `${(applyProgress.done / Math.max(applyProgress.total, 1)) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {applyProgress.done} de {applyProgress.total} — lotes grandes podem levar alguns
                  minutos, não feche esta aba.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setConfirming(false); setConfirmText(""); setConfirmCount(""); }}
                disabled={applying}
                className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                disabled={
                  confirmText !== "CONFIRMAR" ||
                  applying ||
                  (needsReinforcedConfirm && Number(confirmCount) !== selectedRows.length)
                }
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
