import { createServerSupabase } from "@/lib/supabase/server";
import { fetchAllPages, getLatestRunId } from "@/lib/reportData";
import PainelClient from "@/components/PainelClient";
import type { DecisionRow } from "@/components/DecisionTable";

const DECISION_FIELDS =
  "id, mlb, promotion_id, promotion_type, preco_proposto, preco_original, margem_calculada_pct, desconto_consumidor_pct, ml_participacao_pct, ml_participacao_fonte, reducao_tarifa, reducao_tarifa_pct, reducao_tarifa_valor, reducao_tarifa_fonte, troca, campanha_anterior_tipo, campanha_anterior_margem_pct, campanha_anterior_score, recomendacao, sku_referencia, score, gravavel, motivo, status, created_at";

export default async function PainelPage() {
  const supabase = await createServerSupabase();
  const latestRunId = await getLatestRunId(supabase);

  type RawRow = Omit<DecisionRow, "title" | "sku">;

  const decisions = await fetchAllPages<RawRow>((from, to) => {
    let q = supabase
      .from("campaign_decisions")
      .select(DECISION_FIELDS)
      .eq("escolhida", true)
      .eq("status", "pendente")
      .order("mlb", { ascending: true })
      .range(from, to);
    if (latestRunId) q = q.eq("run_id", latestRunId);
    return q;
  });

  const toleranciaDecisions = await fetchAllPages<RawRow>((from, to) => {
    let q = supabase
      .from("campaign_decisions")
      .select(DECISION_FIELDS)
      .eq("status", "tolerancia")
      .order("mlb", { ascending: true })
      .range(from, to);
    if (latestRunId) q = q.eq("run_id", latestRunId);
    return q;
  });

  const allMlbs = [...new Set([...decisions, ...toleranciaDecisions].map((d) => d.mlb))];
  const itemsCache = allMlbs.length
    ? await fetchAllPages<{ mlb: string; title: string | null; sku: string | null }>((from, to) =>
        supabase.from("items_cache").select("mlb, title, sku").in("mlb", allMlbs).range(from, to),
      )
    : [];
  const titleByMlb = new Map(itemsCache.map((i) => [i.mlb, i]));

  const withTitles = (list: RawRow[]): DecisionRow[] =>
    list.map((d) => ({
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
      <PainelClient rows={withTitles(decisions)} toleranciaRows={withTitles(toleranciaDecisions)} />
    </div>
  );
}
