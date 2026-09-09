import type { SupabaseClient } from "@supabase/supabase-js";

/** O Supabase/PostgREST limita cada resposta a 1000 linhas por padrão — sem
 * paginar, uma rodada grande (catálogo com milhares de itens, várias
 * decisões por item) tinha a maior parte dos dados silenciosamente
 * cortada. Busca em blocos de 1000 até esgotar. */
export async function fetchAllPages<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await query(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

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
  troca: boolean;
  campanha_anterior_tipo: string | null;
  campanha_anterior_margem_pct: number | null;
  campanha_anterior_score: number | null;
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

  const rows = await fetchAllPages<Omit<DecisionReportRow, "title"> & { escolhida: boolean }>((from, to) =>
    supabase
      .from("campaign_decisions")
      .select(
        "id, mlb, promotion_id, promotion_type, preco_proposto, preco_original, margem_calculada_pct, desconto_consumidor_pct, reducao_tarifa, reducao_tarifa_pct, reducao_tarifa_valor, troca, campanha_anterior_tipo, campanha_anterior_margem_pct, campanha_anterior_score, score, motivo, status, escolhida, created_at, applied_at",
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const byMlb = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byMlb.has(r.mlb)) byMlb.set(r.mlb, []);
    byMlb.get(r.mlb)!.push(r);
  }

  const mlbs = [...byMlb.keys()];
  const itemsCache = mlbs.length
    ? await fetchAllPages<{ mlb: string; title: string | null }>((from, to) =>
        supabase.from("items_cache").select("mlb, title").in("mlb", mlbs).range(from, to),
      )
    : [];
  const titleByMlb = new Map(itemsCache.map((i) => [i.mlb, i.title]));

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
