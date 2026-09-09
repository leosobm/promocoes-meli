import { createServerSupabase } from "@/lib/supabase/server";
import { fetchAllPages, getLatestRunId } from "@/lib/reportData";
import PainelClient, { type DecisionRow } from "@/components/PainelClient";

export default async function PainelPage() {
  const supabase = await createServerSupabase();
  const latestRunId = await getLatestRunId(supabase);

  const decisions = await fetchAllPages<Omit<DecisionRow, "title" | "sku">>((from, to) => {
    let q = supabase
      .from("campaign_decisions")
      .select(
        "id, mlb, promotion_id, promotion_type, preco_proposto, preco_original, margem_calculada_pct, desconto_consumidor_pct, ml_participacao_pct, ml_participacao_fonte, reducao_tarifa, reducao_tarifa_pct, reducao_tarifa_valor, troca, campanha_anterior_tipo, campanha_anterior_margem_pct, campanha_anterior_score, sku_referencia, score, gravavel, motivo, status, created_at",
      )
      .eq("escolhida", true)
      .eq("status", "pendente")
      .order("mlb", { ascending: true })
      .range(from, to);
    if (latestRunId) q = q.eq("run_id", latestRunId);
    return q;
  });

  const mlbs = [...new Set(decisions.map((d) => d.mlb))];
  const itemsCache = mlbs.length
    ? await fetchAllPages<{ mlb: string; title: string | null; sku: string | null }>((from, to) =>
        supabase.from("items_cache").select("mlb, title, sku").in("mlb", mlbs).range(from, to),
      )
    : [];
  const titleByMlb = new Map(itemsCache.map((i) => [i.mlb, i]));

  const rows: DecisionRow[] = decisions.map((d) => ({
    ...d,
    title: titleByMlb.get(d.mlb)?.title ?? null,
    sku: titleByMlb.get(d.mlb)?.sku ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Painel de decisões</h1>
        <p className="mt-1 text-sm text-neutral-500">
          A melhor campanha calculada por item na última rodada de &quot;Atualizar agora&quot;,
          aguardando sua revisão. Nada foi gravado no Mercado Livre ainda — selecione e confirme
          para aplicar.
        </p>
      </div>
      <PainelClient rows={rows} />
    </div>
  );
}
