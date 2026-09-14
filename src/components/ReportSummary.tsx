import Link from "next/link";
import type { RunReport } from "@/lib/reportData";

function fmtPct(v: number | null) {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}
function fmtMoney(v: number | null) {
  return v == null ? "-" : `R$ ${v.toFixed(2)}`;
}

function Section({
  title,
  color,
  rows,
  emptyText,
  showApplied,
}: {
  title: string;
  color: string;
  rows: RunReport["aderido"];
  emptyText: string;
  showApplied?: boolean;
}) {
  const preview = rows.slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <span className="text-sm text-neutral-400">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-2.5">MLB / Título</th>
                <th className="p-2.5">Campanha</th>
                <th className="p-2.5 text-right">Margem</th>
                <th className="p-2.5 text-right">Red. tarifa</th>
                {showApplied ? (
                  <th className="p-2.5">Aplicada em</th>
                ) : (
                  <th className="p-2.5">Motivo</th>
                )}
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="p-2.5">
                    <div className="font-medium text-neutral-900">{r.mlb}</div>
                    <div className="max-w-[220px] truncate text-xs text-neutral-500">{r.title ?? ""}</div>
                    {r.troca && (
                      <div className="mt-0.5 text-xs font-medium text-blue-700">
                        🔄 Troca: {r.campanha_anterior_tipo} → {r.promotion_type}
                      </div>
                    )}
                  </td>
                  <td className="p-2.5">{r.promotion_type}</td>
                  <td className="p-2.5 text-right">{fmtPct(r.margem_calculada_pct)}</td>
                  <td className="p-2.5 text-right">
                    {r.reducao_tarifa ? (
                      r.reducao_tarifa_fonte === "estimada_meli_percentage" ? (
                        <span className="text-amber-700" title="Estimado a partir de meli_percentage — API não confirma este valor.">
                          ~{fmtMoney(r.reducao_tarifa_valor)}
                        </span>
                      ) : (
                        <span className="text-green-700">{fmtMoney(r.reducao_tarifa_valor)}</span>
                      )
                    ) : (
                      <span className="text-neutral-400">-</span>
                    )}
                  </td>
                  {showApplied ? (
                    <td className="p-2.5 text-xs text-neutral-500">
                      {r.applied_at ? new Date(r.applied_at).toLocaleString("pt-BR") : "-"}
                    </td>
                  ) : (
                    <td className="max-w-[280px] p-2.5 text-xs text-neutral-600">{r.motivo}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > preview.length && (
            <p className="border-t border-neutral-100 p-2 text-center text-xs text-neutral-400">
              mostrando {preview.length} de {rows.length} — exporte pra ver todos
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportSummary({ report }: { report: RunReport }) {
  if (!report.runId) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Ainda não rodou nenhuma atualização — clique em &quot;Atualizar agora&quot; pra gerar o
        primeiro relatório.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Relatório da última atualização
          </h2>
          <p className="text-xs text-neutral-500">
            {report.createdAt && new Date(report.createdAt).toLocaleString("pt-BR")} —{" "}
            {report.totalItens} item(ns) processado(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/relatorio/export?runId=${report.runId}`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Exportar (.xlsx)
          </a>
          <Link href="/painel" className="text-sm font-medium text-neutral-700 hover:underline">
            Ver painel completo →
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Section
          title="Aderido"
          color="bg-green-500"
          rows={report.aderido}
          emptyText="Nenhuma campanha aplicada ainda nesta rodada."
          showApplied
        />
        <Section
          title="Para revisão"
          color="bg-amber-500"
          rows={report.paraRevisao}
          emptyText="Nada pendente de revisão nesta rodada."
        />
        <Section
          title="Não aderido"
          color="bg-neutral-400"
          rows={report.naoAderido}
          emptyText="Todos os itens tiveram alguma campanha viável."
        />
      </div>
    </div>
  );
}
