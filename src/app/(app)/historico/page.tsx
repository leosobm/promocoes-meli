import { createServerSupabase } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = {
  aplicada: "Aplicada",
  erro: "Erro",
  rejeitada: "Rejeitada (margem)",
  pendente: "Pendente",
};

const STATUS_COLOR: Record<string, string> = {
  aplicada: "bg-green-100 text-green-800",
  erro: "bg-red-100 text-red-800",
  rejeitada: "bg-neutral-100 text-neutral-600",
  pendente: "bg-amber-100 text-amber-800",
};

export default async function HistoricoPage() {
  const supabase = await createServerSupabase();
  const { data: decisions } = await supabase
    .from("campaign_decisions")
    .select("id, mlb, promotion_type, preco_proposto, margem_calculada_pct, status, motivo, created_at, applied_at")
    .neq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Histórico de decisões</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Tudo que já foi aplicado, rejeitado (abaixo da margem mínima) ou deu erro — com o motivo.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="p-3">Quando</th>
              <th className="p-3">MLB</th>
              <th className="p-3">Campanha</th>
              <th className="p-3 text-right">Preço</th>
              <th className="p-3 text-right">Margem</th>
              <th className="p-3">Status</th>
              <th className="p-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {(decisions ?? []).map((d) => (
              <tr key={d.id} className="border-t border-neutral-100 align-top">
                <td className="whitespace-nowrap p-3 text-xs text-neutral-500">
                  {new Date(d.applied_at ?? d.created_at).toLocaleString("pt-BR")}
                </td>
                <td className="p-3 font-medium">{d.mlb}</td>
                <td className="p-3">{d.promotion_type}</td>
                <td className="p-3 text-right">{d.preco_proposto ? `R$ ${d.preco_proposto.toFixed(2)}` : "-"}</td>
                <td className="p-3 text-right">
                  {d.margem_calculada_pct != null ? `${d.margem_calculada_pct.toFixed(1)}%` : "-"}
                </td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[d.status] ?? ""}`}>
                    {STATUS_LABEL[d.status] ?? d.status}
                  </span>
                </td>
                <td className="max-w-sm p-3 text-xs text-neutral-600">{d.motivo}</td>
              </tr>
            ))}
            {(decisions ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-neutral-500">
                  Nada no histórico ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
