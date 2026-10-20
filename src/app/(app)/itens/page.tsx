import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import { formatDateTimeBrasilia } from "@/lib/timezone";
import UploadItemsForm from "@/components/UploadItemsForm";

const CURVAS = ["A", "B", "C", "D", "Lançamento"] as const;
const LIMITE = 500;

export default async function ItensPage({
  searchParams,
}: {
  searchParams: Promise<{ mlb?: string; sku?: string; curva?: string }>;
}) {
  const current = await getCurrentUser();
  if (current?.role !== "admin") redirect("/");

  const { mlb, sku, curva } = await searchParams;
  const temFiltro = !!(mlb?.trim() || sku?.trim() || curva?.trim());

  const supabase = await createServerSupabase();

  let itemsQuery = supabase
    .from("item_config")
    .select("mlb, sku, cmv, margem_minima_pct, margem_alvo_pct, margem_teto_pct, curva, participar_campanhas, updated_at");
  let countQuery = supabase.from("item_config").select("*", { count: "exact", head: true });
  if (mlb?.trim()) {
    itemsQuery = itemsQuery.ilike("mlb", `%${mlb.trim()}%`);
    countQuery = countQuery.ilike("mlb", `%${mlb.trim()}%`);
  }
  if (sku?.trim()) {
    itemsQuery = itemsQuery.ilike("sku", `%${sku.trim()}%`);
    countQuery = countQuery.ilike("sku", `%${sku.trim()}%`);
  }
  if (curva?.trim()) {
    itemsQuery = itemsQuery.eq("curva", curva.trim());
    countQuery = countQuery.eq("curva", curva.trim());
  }

  const { data: items } = await itemsQuery.order("updated_at", { ascending: false }).limit(LIMITE);
  const { count: totalCorrespondente } = await countQuery;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Itens (custo e margem)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Envie um .csv ou .xlsx com colunas mlb, sku, cmv, margem_minima_pct (opcional),
          margem_alvo_pct (opcional), margem_teto_pct (opcional), curva (opcional: A, B, C, D ou
          Lançamento), participar_campanhas (opcional). Item sem margem própria usa a margem da
          sua curva (se tiver) ou a margem geral do sistema, definidas em Configurações. Upload é
          incremental — atualiza só quem está no arquivo, não apaga o resto.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Item com variação (várias cores/tamanhos sob o mesmo MLB): repita o MLB numa linha por
          SKU, cada um com seu próprio custo. O Mercado Livre grava o preço promocional a nível
          de MLB (não por variação), então o sistema usa a variação de maior custo como
          referência de segurança — a campanha só é aceita se a margem continuar OK até para ela.
        </p>
        <a
          href="/api/itens/template"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Baixar modelo (.xlsx) — com aba explicando cada coluna
        </a>
      </div>

      <UploadItemsForm />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-neutral-600">MLB</label>
          <input
            type="text"
            name="mlb"
            defaultValue={mlb ?? ""}
            placeholder="ex: MLB3462431518"
            className="mt-1 w-48 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600">SKU</label>
          <input
            type="text"
            name="sku"
            defaultValue={sku ?? ""}
            placeholder="ex: 64.02"
            className="mt-1 w-40 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600">Curva</label>
          <select
            name="curva"
            defaultValue={curva ?? ""}
            className="mt-1 w-40 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {CURVAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filtrar
        </button>
        {temFiltro && (
          <a href="/itens" className="text-sm font-medium text-neutral-600 hover:underline">
            Limpar filtros
          </a>
        )}
      </form>

      <p className="text-sm text-neutral-500">
        {(totalCorrespondente ?? 0)} item(ns) {temFiltro ? "encontrado(s) com esse filtro" : "cadastrado(s)"}
        {(totalCorrespondente ?? 0) > LIMITE &&
          ` — mostrando os ${LIMITE} mais recentes; refine a busca por MLB, SKU ou curva pra encontrar um item específico fora dessa lista.`}
      </p>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="p-3">MLB</th>
              <th className="p-3">SKU</th>
              <th className="p-3 text-right">CMV</th>
              <th className="p-3 text-right">Margem mínima</th>
              <th className="p-3 text-right">Margem alvo</th>
              <th className="p-3 text-right">Teto</th>
              <th className="p-3">Curva</th>
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
                <td className="p-3 text-right">
                  {i.margem_minima_pct != null ? `${i.margem_minima_pct}%` : <span className="text-neutral-400">Geral do sistema</span>}
                </td>
                <td className="p-3 text-right">
                  {i.margem_alvo_pct != null ? `${i.margem_alvo_pct}%` : <span className="text-neutral-400">Geral do sistema</span>}
                </td>
                <td className="p-3 text-right">
                  {i.margem_teto_pct != null ? `${i.margem_teto_pct}%` : <span className="text-neutral-400">Sem teto</span>}
                </td>
                <td className="p-3">{i.curva ?? <span className="text-neutral-400">-</span>}</td>
                <td className="p-3">{i.participar_campanhas ? "Sim" : "Não"}</td>
                <td className="p-3 text-xs text-neutral-500">
                  {formatDateTimeBrasilia(i.updated_at)}
                </td>
              </tr>
            ))}
            {(items ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-neutral-500">
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
