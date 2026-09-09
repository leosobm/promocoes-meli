import { createServerSupabase } from "@/lib/supabase/server";
import UploadItemsForm from "@/components/UploadItemsForm";

export default async function ItensPage() {
  const supabase = await createServerSupabase();
  const { data: items } = await supabase
    .from("item_config")
    .select("mlb, sku, cmv, margem_minima_pct, margem_alvo_pct, participar_campanhas, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Itens (custo e margem)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Envie um .csv ou .xlsx com colunas mlb/sku, cmv, margem_minima_pct, margem_alvo_pct
          (opcional), participar_campanhas (opcional). Upload é incremental — atualiza só quem
          está no arquivo, não apaga o resto.
        </p>
        <a
          href="/api/itens/template"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Baixar modelo (.xlsx) — com aba explicando cada coluna
        </a>
      </div>

      <UploadItemsForm />

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="p-3">MLB</th>
              <th className="p-3">SKU</th>
              <th className="p-3 text-right">CMV</th>
              <th className="p-3 text-right">Margem mínima</th>
              <th className="p-3 text-right">Margem alvo</th>
              <th className="p-3">Participa?</th>
              <th className="p-3">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.mlb} className="border-t border-neutral-100">
                <td className="p-3 font-medium">{i.mlb}</td>
                <td className="p-3">{i.sku ?? "-"}</td>
                <td className="p-3 text-right">R$ {i.cmv.toFixed(2)}</td>
                <td className="p-3 text-right">{i.margem_minima_pct}%</td>
                <td className="p-3 text-right">{i.margem_alvo_pct != null ? `${i.margem_alvo_pct}%` : "-"}</td>
                <td className="p-3">{i.participar_campanhas ? "Sim" : "Não"}</td>
                <td className="p-3 text-xs text-neutral-500">
                  {new Date(i.updated_at).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
            {(items ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-neutral-500">
                  Nenhum item cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
