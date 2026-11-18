import { createServerSupabase } from "@/lib/supabase/server";
import { isConnected } from "@/lib/mercadolivre/tokens";
import { fetchAllPages } from "@/lib/reportData";
import { carregarGmv } from "@/lib/gmv";
import UpdateButton from "@/components/UpdateButton";
import CatalogoTable, { type CatalogContagem, type CatalogRow } from "@/components/CatalogoTable";

const FIELDS =
  "id, mlb, situacao, status_competicao, boosts_faltantes, orientacao, vencedor_item_id, vencedor_preco, preco_atual, preco_para_ganhar, preco_sugerido, margem_sem_incentivo_pct, margem_minima_pct, incentivo_necessario_valor, incentivo_necessario_pct, sku_referencia, promotion_type, preco_proposto, margem_campanha_pct, reducao_tarifa_valor, troca, gravavel, motivo, status";

export default async function CatalogoPage() {
  const connected = await isConnected();
  const supabase = await createServerSupabase();

  const { data: ultima } = await supabase
    .from("catalog_decisions")
    .select("run_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const contagem: CatalogContagem = { ganhando: 0, preco: 0, outro_motivo: 0, erro: 0 };
  let rows: CatalogRow[] = [];
  let gmvCalculadoEm: string | null = null;
  if (ultima) {
    type Raw = Omit<CatalogRow, "title" | "sku" | "situacao" | "gmv_30d" | "share_gmv_pct"> & {
      situacao: CatalogRow["situacao"] | "ganhando";
    };
    const todas = await fetchAllPages<Raw>((from, to) =>
      supabase
        .from("catalog_decisions")
        .select(FIELDS)
        .eq("run_id", ultima.run_id)
        .neq("situacao", "nao_catalogo")
        .order("mlb", { ascending: true })
        .range(from, to),
    );
    for (const r of todas) contagem[r.situacao] += 1;
    const acionaveis = todas.filter(
      (r): r is Omit<CatalogRow, "title" | "sku" | "gmv_30d" | "share_gmv_pct"> => r.situacao !== "ganhando",
    );

    // .in() vai na URL — blocos pequenos (ver mlbsAtivosNoCache).
    const mlbs = [...new Set(acionaveis.map((r) => r.mlb))];
    const cache = new Map<string, { title: string | null; sku: string | null }>();
    for (let i = 0; i < mlbs.length; i += 150) {
      const { data } = await supabase.from("items_cache").select("mlb, title, sku").in("mlb", mlbs.slice(i, i + 150));
      for (const it of data ?? []) cache.set(it.mlb, { title: it.title, sku: it.sku });
    }
    const gmv = await carregarGmv(supabase, mlbs);
    gmvCalculadoEm = gmv.calculadoEm;
    const temFoto = gmv.calculadoEm !== null;
    rows = acionaveis.map((r) => ({
      ...r,
      title: cache.get(r.mlb)?.title ?? null,
      sku: cache.get(r.mlb)?.sku ?? null,
      // Sem linha na foto = sem venda no período (0%); sem foto = nunca calculado.
      gmv_30d: temFoto ? (gmv.porMlb.get(r.mlb)?.gmv ?? 0) : null,
      share_gmv_pct: temFoto ? (gmv.porMlb.get(r.mlb)?.share_pct ?? 0) : null,
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Catálogo</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Disputa do buybox nos seus anúncios de catálogo ativos: o que falta pra ganhar quando você está
          perdendo — preço (com margem e incentivo necessário) ou outro motivo. Nada é gravado no Mercado
          Livre sem você selecionar e confirmar.
        </p>
      </div>

      {connected ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <UpdateButton modo="catalogo" />
          {ultima && (
            <p className="mt-3 text-xs text-neutral-500">
              Última análise: {new Date(ultima.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              {gmvCalculadoEm && (
                <>
                  {" "}· share de GMV (30 dias) calculado em{" "}
                  {new Date(gmvCalculadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          A conta do Mercado Livre não está conectada — conecte pelo Painel antes de analisar o catálogo.
        </p>
      )}

      {ultima ? (
        <CatalogoTable rows={rows} contagem={contagem} />
      ) : (
        <p className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          Nenhuma análise de catálogo ainda. Clique em &quot;Analisar catálogo&quot;.
        </p>
      )}
    </div>
  );
}
