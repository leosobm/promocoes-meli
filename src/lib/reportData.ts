import type { SupabaseClient } from "@supabase/supabase-js";

export interface DecisionReportRow {
  id: string;
  mlb: string;
  title: string | null;
  promotion_id: string | null;
  promotion_type: string;
  preco_proposto: number | null;
  preco_original: number | null;
  margem_calculada_pct: number | null;
  desconto_consumidor_pct: number | null;
  reducao_tarifa: boolean;
  reducao_tarifa_pct: number | null;
  reducao_tarifa_valor: number | null;
  score: number | null;
  motivo: string;
  status: string;
  created_at: string;
  applied_at: string | null;
}

export interface RunReport {
  runId: string | null;
  createdAt: string | null;
  totalItens: number;
  aderido: DecisionReportRow[];
  naoAderido: DecisionReportRow[];
  paraRevisao: DecisionReportRow[];
}

/** Id da rodada de "Atualizar agora" mais recente (null se nunca rodou). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLatestRunId(supabase: SupabaseClient<any>): Promise<string | null> {
  const { data } = await supabase
    .from("campaign_decisions")
    .select("run_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.run_id ?? null;
}

/**
 * Relatório da rodada mais recente — UMA linha por MLB (não por
 * decisão/campanha avaliada), pra cada item cair em exatamente um balde:
 *   aderido: a campanha escolhida foi aplicada com sucesso
 *   naoAderido: sem campanha escolhida (nenhuma viável, ou todas abaixo da
 *     margem mínima) OU a escolhida deu erro ao tentar aplicar
 *   paraRevisao: campanha escolhida, calculada, aguardando aplicar
 * Quando o item não tem campanha escolhida (nenhuma viável), usa como
 * representante o erro de item, ou a candidata rejeitada com maior score
 * (a que chegou mais perto de valer a pena).
 */
export async function getLatestRunReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  runIdParam?: string,
): Promise<RunReport> {
  const runId = runIdParam ?? (await getLatestRunId(supabase));
  if (!runId) {
    return { runId: null, createdAt: null, totalItens: 0, aderido: [], naoAderido: [], paraRevisao: [] };
  }

  const { data: decisions } = await supabase
    .from("campaign_decisions")
    .select(
      "id, mlb, promotion_id, promotion_type, preco_proposto, preco_original, margem_calculada_pct, desconto_consumidor_pct, reducao_tarifa, reducao_tarifa_pct, reducao_tarifa_valor, score, motivo, status, escolhida, created_at, applied_at",
    )
    .eq("run_id", runId)
    .order("created_at", { ascending: false });

  const rows = decisions ?? [];
  const byMlb = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byMlb.has(r.mlb)) byMlb.set(r.mlb, []);
    byMlb.get(r.mlb)!.push(r);
  }

  const mlbs = [...byMlb.keys()];
  const { data: itemsCache } = mlbs.length
    ? await supabase.from("items_cache").select("mlb, title").in("mlb", mlbs)
    : { data: [] };
  const titleByMlb = new Map((itemsCache ?? []).map((i) => [i.mlb, i.title as string | null]));

  const aderido: DecisionReportRow[] = [];
  const naoAderido: DecisionReportRow[] = [];
  const paraRevisao: DecisionReportRow[] = [];

  for (const [mlb, group] of byMlb) {
    const escolhida = group.find((r) => r.escolhida);
    let representative: (typeof group)[number];

    if (escolhida) {
      representative = escolhida;
    } else {
      const erroRow = group.find((r) => r.status === "erro");
      const melhorRejeitada = [...group].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))[0];
      representative = erroRow ?? melhorRejeitada ?? group[0];
    }

    const withTitle: DecisionReportRow = { ...representative, title: titleByMlb.get(mlb) ?? null };

    if (representative.status === "aplicada") aderido.push(withTitle);
    else if (representative.status === "pendente" && representative.escolhida) paraRevisao.push(withTitle);
    else naoAderido.push(withTitle); // rejeitada, erro, ou pendente-sem-escolhida (sem campanha viável)
  }

  return {
    runId,
    createdAt: rows[0]?.created_at ?? null,
    totalItens: byMlb.size,
    aderido,
    naoAderido,
    paraRevisao,
  };
}
