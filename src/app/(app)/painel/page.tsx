import { createServerSupabase } from "@/lib/supabase/server";
import { fetchAllPages, getLatestRunId } from "@/lib/reportData";
import { carregarGmv } from "@/lib/gmv";
import PainelClient from "@/components/PainelClient";
import type { DecisionRow } from "@/components/DecisionTable";

const DECISION_FIELDS =
  "id, mlb, promotion_id, promotion_type, preco_proposto, preco_original, preco_atual, margem_calculada_pct, desconto_consumidor_pct, ml_participacao_pct, ml_participacao_fonte, reducao_tarifa, reducao_tarifa_pct, reducao_tarifa_valor, reducao_tarifa_fonte, troca, campanha_anterior_tipo, campanha_anterior_margem_pct, campanha_anterior_score, recomendacao, sku_referencia, score, gravavel, motivo, status, created_at";

export default async function PainelPage() {
  const supabase = await createServerSupabase();
  const latestRunId = await getLatestRunId(supabase);

  type RawRow = Omit<DecisionRow, "title" | "sku" | "gmv_30d" | "share_gmv_pct">;

  const decisions = await fetchAllPages<RawRow>((from, to) => {
    let q = supabase
      .from("campaign_decisions")
      .select(DECISION_FIELDS)
      .eq("escolhida", true)
      .eq("status", "pendente")
      .neq("recomendacao", "mantida") // nada pra revisar quando a campanha atual já é a melhor
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
  // .in() vai na URL — com centenas de MLBs numa chamada só a consulta
  // falhava calada e os títulos sumiam (ver mlbsAtivosNoCache).
  const titleByMlb = new Map<string, { title: string | null; sku: string | null }>();
  for (let i = 0; i < allMlbs.length; i += 150) {
    const { data } = await supabase.from("items_cache").select("mlb, title, sku").in("mlb", allMlbs.slice(i, i + 150));
    for (const it of data ?? []) titleByMlb.set(it.mlb, { title: it.title, sku: it.sku });
  }
  const gmv = await carregarGmv(supabase, allMlbs);
  const temFotoGmv = gmv.calculadoEm !== null;

  const withTitles = (list: RawRow[]): DecisionRow[] =>
    list.map((d) => ({
      ...d,
      title: titleByMlb.get(d.mlb)?.title ?? null,
      sku: titleByMlb.get(d.mlb)?.sku ?? null,
      // Sem linha na foto = sem venda no período (0%); sem foto = nunca calculado.
      gmv_30d: temFotoGmv ? (gmv.porMlb.get(d.mlb)?.gmv ?? 0) : null,
      share_gmv_pct: temFotoGmv ? (gmv.porMlb.get(d.mlb)?.share_pct ?? 0) : null,
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
        {gmv.calculadoEm && (
          <p className="mt-1 text-xs text-neutral-400">
            Share de GMV: últimos 30 dias, calculado em{" "}
            {new Date(gmv.calculadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
          </p>
        )}
      </div>
      <PainelClient rows={withTitles(decisions)} toleranciaRows={withTitles(toleranciaDecisions)} />
    </div>
  );
}
