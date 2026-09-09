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
  sku_referencia: string | null;
  score: number | null;
  gravavel: boolean;
  motivo: string;
  status: string;
  created_at: string;
  title: string | null;
  sku: string | null;
}

function fmtPct(v: number | null) {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}
function fmtMoney(v: number | null) {
  return v == null ? "-" : `R$ ${v.toFixed(2)}`;
}

function IncentivoMlCell({ row }: { row: DecisionRow }) {
  if (!row.reducao_tarifa) return <span className="text-neutral-400">Não</span>;
  return (
    <div>
      <span className="font-medium text-green-700">Sim</span>
      <div className="text-xs text-neutral-500">
        {fmtMoney(row.reducao_tarifa_valor)}
        {row.reducao_tarifa_pct != null ? ` (${row.reducao_tarifa_pct.toFixed(1)}%)` : ""}
      </div>
    </div>
  );
}

export default function PainelClient({ rows }: { rows: DecisionRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const gravaveis = useMemo(() => rows.filter((r) => r.gravavel), [rows]);
  const naoGravaveis = useMemo(() => rows.filter((r) => !r.gravavel), [rows]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === gravaveis.length ? new Set() : new Set(gravaveis.map((r) => r.id))));
  }

  async function handleApply() {
    setApplying(true);
    setResult(null);
    try {
      const resp = await fetch("/api/aplicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionIds: [...selected], confirmacao: confirmText }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setResult(`Erro: ${data.error}`);
      } else {
        const ok = data.results.filter((r: { ok: boolean }) => r.ok).length;
        const fail = data.results.length - ok;
        setResult(`Aplicado: ${ok} com sucesso, ${fail} com erro/pulado. Veja o Histórico para detalhes.`);
        setSelected(new Set());
      }
    } catch (e) {
      setResult(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplying(false);
      setConfirming(false);
      setConfirmText("");
      router.refresh();
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Nenhuma decisão pendente. Rode &quot;Atualizar agora&quot; no Painel para calcular.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {gravaveis.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.size === gravaveis.length && gravaveis.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th className="p-3">MLB / Título</th>
                <th className="p-3">Campanha</th>
                <th className="p-3 text-right">Preço proposto</th>
                <th className="p-3 text-right">Desconto</th>
                <th className="p-3 text-right">Margem</th>
                <th className="p-3 text-right">Part. ML</th>
                <th className="p-3">Incentivo ML (tarifa)</th>
                <th className="p-3 text-right">Score</th>
                <th className="p-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {gravaveis.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 align-top">
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-neutral-900">{r.mlb}</div>
                    <div className="max-w-xs truncate text-xs text-neutral-500">{r.title ?? r.sku ?? ""}</div>
                    {r.sku_referencia && (
                      <div className="text-xs text-amber-700">SKU ref.: {r.sku_referencia}</div>
                    )}
                  </td>
                  <td className="p-3">{r.promotion_type}</td>
                  <td className="p-3 text-right">{fmtMoney(r.preco_proposto)}</td>
                  <td className="p-3 text-right">{fmtPct(r.desconto_consumidor_pct)}</td>
                  <td className="p-3 text-right">{fmtPct(r.margem_calculada_pct)}</td>
                  <td className="p-3 text-right">{fmtPct(r.ml_participacao_pct)}</td>
                  <td className="p-3">
                    <IncentivoMlCell row={r} />
                  </td>
                  <td className="p-3 text-right">{r.score?.toFixed(1) ?? "-"}</td>
                  <td className="max-w-xs p-3 text-xs text-neutral-600">{r.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gravaveis.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            disabled={selected.size === 0}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            Aplicar selecionados ({selected.size})
          </button>
          {result && <span className="text-sm text-neutral-600">{result}</span>}
        </div>
      )}

      {naoGravaveis.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-neutral-700">
            Melhores campanhas sem gravação automática (aplique manualmente pelo painel do ML)
          </h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="p-3">MLB / Título</th>
                  <th className="p-3">Campanha</th>
                  <th className="p-3 text-right">Margem</th>
                  <th className="p-3">Incentivo ML (tarifa)</th>
                  <th className="p-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {naoGravaveis.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="p-3">
                      <div className="font-medium text-neutral-900">{r.mlb}</div>
                      <div className="text-xs text-neutral-500">{r.title ?? r.sku ?? ""}</div>
                    </td>
                    <td className="p-3">{r.promotion_type}</td>
                    <td className="p-3 text-right">{fmtPct(r.margem_calculada_pct)}</td>
                    <td className="p-3">
                      <IncentivoMlCell row={r} />
                    </td>
                    <td className="max-w-xs p-3 text-xs text-neutral-600">{r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-neutral-900">Confirmar gravação real</h3>
            <p className="text-sm text-neutral-600">
              Isso vai gravar {selected.size} adesão(ões) de campanha na sua conta REAL do Mercado
              Livre — preços promocionais são um compromisso comercial. Digite{" "}
              <b>CONFIRMAR</b> para prosseguir.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              placeholder="CONFIRMAR"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
                className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
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
