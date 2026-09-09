import { randomUUID } from "crypto";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { getCampaignTypeConfig } from "@/lib/mercadolivre/campaignTypes";
import { resolveCurrentPrice } from "@/lib/mercadolivre/variations";
import {
  calcDescontoConsumidorPct,
  calcMargemResultante,
  calcPrecoParaMargem,
  calcScore,
  type ScoreWeights,
} from "@/lib/scoring";
import type { ItemDetail, ItemPromotion } from "@/lib/mercadolivre/types";

export type ProgressEvent =
  | { type: "log"; message: string }
  | { type: "progress"; done: number; total: number }
  | { type: "partial"; runId: string; done: number; total: number }
  | { type: "done"; runId: string; totalDecisions: number; totalEscolhidas: number }
  | { type: "error"; message: string };

// Status da API que significam "o item JÁ está participando desta
// campanha agora" (não é candidata nem programada) — mesmo bucket
// "Participando" do mercadolivre_promocoes.py original.
const ACTIVE_STATUSES = new Set(["accepted", "active", "started", "joined", "in_progress"]);

// Quantos MLBs processar em paralelo — cada um faz ~4 chamadas à API do ML
// (detalhe do item, comissão, frete grátis, promoções). Sequencial não cabe
// no limite de tempo de uma function com catálogos grandes (visto na
// prática: 1000 MLBs). Ajuste pra baixo se começar a ver erros de rate
// limit (429) da API do Mercado Livre.
const CONCURRENCY = 15;

interface AppSettings {
  taxas_pct: number;
  peso_desconto_pct: number;
  peso_ml_pct: number;
  peso_margem_pct: number;
}

export interface ItemConfigRow {
  mlb: string;
  sku: string; // '' = item sem variação (ou variação não informada)
  cmv: number;
  margem_minima_pct: number;
  margem_alvo_pct: number | null;
}

interface VariacaoResultado {
  sku: string | null;
  cmv: number;
  margem_calculada_pct: number | null;
}

interface DecisionInsertRow {
  mlb: string;
  promotion_id?: string;
  promotion_type: string;
  offer_id?: string | null;
  preco_proposto?: number | null;
  preco_original?: number | null;
  margem_calculada_pct?: number | null;
  desconto_consumidor_pct?: number | null;
  ml_participacao_pct?: number | null;
  ml_participacao_fonte?: string | null;
  reducao_tarifa?: boolean;
  reducao_tarifa_pct?: number | null;
  reducao_tarifa_valor?: number | null;
  troca?: boolean;
  campanha_anterior_id?: string | null;
  campanha_anterior_tipo?: string | null;
  campanha_anterior_offer_id?: string | null;
  campanha_anterior_margem_pct?: number | null;
  campanha_anterior_score?: number | null;
  sku_referencia?: string | null;
  variacoes?: VariacaoResultado[] | null;
  score?: number | null;
  escolhida?: boolean;
  gravavel?: boolean;
  motivo: string;
  status: string;
  run_id: string;
}

interface MlbResult {
  decisionRows: DecisionInsertRow[];
  itemsCacheRow: Record<string, unknown> | null;
  logs: string[];
  escolhidas: number;
}

export interface RunContext {
  client: MercadoLivreClient;
  userId: number;
  taxasPct: number;
  weights: ScoreWeights;
  runId: string;
}

/** Extrai o percentual "participação do ML" e a fonte usada — para
 * auditoria (o painel deixa claro qual sinal foi usado). */
function extractMlParticipacao(p: ItemPromotion): { pct: number | null; fonte: string | null } {
  if (p.discount_meli_boosted_percentage != null) {
    return { pct: p.discount_meli_boosted_percentage / 100, fonte: "discount_meli_boosted_percentage" };
  }
  const meliPct = p.meli_percentage ?? p.benefits?.meli_percent ?? null;
  if (meliPct != null) return { pct: meliPct / 100, fonte: "meli_percentage" };
  return { pct: null, fonte: null };
}

/** Preço mínimo necessário pra UMA variação atingir sua margem-alvo (ou, se
 * isso for matematicamente impossível — taxas+comissão já comem tudo —,
 * tenta a margem mínima como segunda tentativa antes de desistir). */
function precoNecessarioParaRow(
  row: ItemConfigRow,
  ctx: { freteMedio: number; taxasPct: number; comissaoPct: number; descontoTarifaPct: number },
): { preco: number; erro: null } | { preco: null; erro: string } {
  const alvoFrac = (row.margem_alvo_pct ?? row.margem_minima_pct) / 100;
  try {
    return { preco: calcPrecoParaMargem({ cmv: row.cmv, ...ctx, margemAlvoPct: alvoFrac }), erro: null };
  } catch {
    if (row.margem_alvo_pct == null) {
      return {
        preco: null,
        erro: `Taxas + comissão já ultrapassam a margem mínima de ${row.margem_minima_pct}% — nenhum preço cobre isso.`,
      };
    }
    const minimaFrac = row.margem_minima_pct / 100;
    try {
      return { preco: calcPrecoParaMargem({ cmv: row.cmv, ...ctx, margemAlvoPct: minimaFrac }), erro: null };
    } catch {
      return {
        preco: null,
        erro: `Taxas + comissão já ultrapassam a margem mínima de ${row.margem_minima_pct}% — nenhum preço cobre isso.`,
      };
    }
  }
}

function rowLabel(row: ItemConfigRow): string {
  return row.sku ? `SKU ${row.sku}` : `${row.mlb} (sem SKU)`;
}

function extractSku(item: ItemDetail): string | null {
  const fromItem = item.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  if (fromItem) return fromItem;
  const fromVariation = item.variations?.[0]?.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  return fromVariation ?? null;
}

export async function processMlb(mlb: string, rows: ItemConfigRow[], ctx: RunContext): Promise<MlbResult> {
  const logs: string[] = [];
  const decisionRows: DecisionInsertRow[] = [];
  // Sempre incluir escolhida/gravavel (mesmo nas saídas antecipadas de
  // erro) — um .insert() em lote com objetos de chaves diferentes manda
  // NULL explícito pra coluna ausente numas linhas em vez de aplicar o
  // DEFAULT do banco, o que viola a constraint NOT NULL dessas colunas.
  const base = { run_id: ctx.runId, escolhida: false, gravavel: false, reducao_tarifa: false };

  const detail = await ctx.client.getItemDetail(mlb);
  if (!detail) {
    decisionRows.push({
      ...base, mlb, promotion_type: "-",
      motivo: "Não foi possível obter os detalhes do anúncio na API (item removido/inativo?).",
      status: "erro",
    });
    return { decisionRows, itemsCacheRow: null, logs, escolhidas: 0 };
  }

  const itemsCacheRow = {
    mlb,
    title: detail.title ?? null,
    category_id: detail.category_id ?? null,
    price: detail.price ?? null,
    sku: extractSku(detail),
    listing_type_id: detail.listing_type_id ?? null,
    shipping: detail.shipping ?? null,
    status: detail.status ?? null,
    fetched_at: new Date().toISOString(),
  };

  for (const row of rows) {
    if (!row.sku) continue;
    const { skuEncontrado } = resolveCurrentPrice(detail, row.sku);
    if (!skuEncontrado) {
      logs.push(`[aviso] ${mlb}: SKU '${row.sku}' não encontrado nas variações do anúncio — usando preço do item inteiro como aproximação.`);
    }
  }

  const [commission, freeShipping, promotions] = await Promise.all([
    ctx.client.getCommission(detail),
    ctx.client.getFreeShippingCost(ctx.userId, detail),
    ctx.client.getItemPromotions(mlb),
  ]);

  if (!commission.ok || commission.percentage_fee == null) {
    decisionRows.push({
      ...base, mlb, promotion_type: "-",
      motivo: `Não foi possível calcular a comissão (${commission.error ?? "sem detalhe"}) — item pulado.`,
      status: "erro",
    });
    return { decisionRows, itemsCacheRow, logs, escolhidas: 0 };
  }
  const comissaoPct = commission.percentage_fee / 100;
  const freteMedio = freeShipping.ok ? freeShipping.list_cost ?? 0 : 0;

  if (promotions.length === 0) {
    decisionRows.push({
      ...base, mlb, promotion_type: "-",
      motivo: "Nenhuma campanha candidata/ativa encontrada para este item.",
      status: "pendente",
    });
    return { decisionRows, itemsCacheRow, logs, escolhidas: 0 };
  }

  const evaluated: {
    promo: ItemPromotion;
    preco: number;
    margemPct: number; // pior margem entre as variações
    skuReferencia: string | null;
    descontoPct: number;
    mlPct: number | null;
    mlFonte: string | null;
    score: number;
    rejeitada: string | null;
    variacoes: VariacaoResultado[] | null;
  }[] = [];

  for (const promo of promotions) {
    const typeCfg = getCampaignTypeConfig(promo.promotion_type);
    const { pct: mlPct, fonte: mlFonte } = extractMlParticipacao(promo);
    const descontoTarifaPctFrac = mlFonte === "discount_meli_boosted_percentage" ? (mlPct ?? 0) : 0;
    const descontoTarifaValor = promo.discount_meli_boost_amount ?? 0;
    const priceCtx = { freteMedio, taxasPct: ctx.taxasPct, comissaoPct, descontoTarifaPct: descontoTarifaPctFrac };

    let preco: number;

    if (typeCfg.priceMode === "seller_defined") {
      let maiorPreco = -Infinity;
      let erroImpossivel: string | null = null;
      for (const row of rows) {
        const r = precoNecessarioParaRow(row, priceCtx);
        if (r.erro !== null) {
          erroImpossivel = `${rowLabel(row)}: ${r.erro}`;
          break;
        }
        const precoRow: number = r.preco;
        if (precoRow > maiorPreco) maiorPreco = precoRow;
      }
      if (erroImpossivel) {
        evaluated.push({
          promo, preco: 0, margemPct: -Infinity, skuReferencia: null, descontoPct: 0,
          mlPct, mlFonte, score: 0, rejeitada: erroImpossivel, variacoes: null,
        });
        continue;
      }
      preco = maiorPreco;
      if (promo.min_discounted_price != null && preco < promo.min_discounted_price) preco = promo.min_discounted_price;
      if (promo.max_discounted_price != null && preco > promo.max_discounted_price) preco = promo.max_discounted_price;
    } else {
      preco = promo.total_price_for_boosted_offer ?? promo.price ?? 0;
      if (!preco) {
        evaluated.push({
          promo, preco: 0, margemPct: -Infinity, skuReferencia: null, descontoPct: 0,
          mlPct, mlFonte, score: 0,
          rejeitada: "Campanha sem preço definido pela API e sem dados suficientes para calcular (tipo sem preço por item).",
          variacoes: null,
        });
        continue;
      }
    }

    const variacoes: VariacaoResultado[] = [];
    let pior: { row: ItemConfigRow; margemFrac: number } | null = null;
    let rejeitadaPorRow: string | null = null;
    for (const row of rows) {
      const margemFrac = calcMargemResultante({
        preco, cmv: row.cmv, freteMedio, comissaoPct, taxasPct: ctx.taxasPct, descontoTarifaValor,
      });
      variacoes.push({ sku: row.sku || null, cmv: row.cmv, margem_calculada_pct: margemFrac * 100 });
      if (!pior || margemFrac < pior.margemFrac) pior = { row, margemFrac };
      if (margemFrac < row.margem_minima_pct / 100 && !rejeitadaPorRow) {
        rejeitadaPorRow = `${rowLabel(row)}: margem resultante ${(margemFrac * 100).toFixed(1)}% fica abaixo do mínimo de ${row.margem_minima_pct}% (preço único do MLB nesta campanha é R$ ${preco.toFixed(2)}).`;
      }
    }

    if (rejeitadaPorRow) {
      evaluated.push({
        promo, preco, margemPct: pior!.margemFrac, skuReferencia: pior!.row.sku || null,
        descontoPct: 0, mlPct, mlFonte, score: 0, rejeitada: rejeitadaPorRow, variacoes,
      });
      continue;
    }

    const { price: precoAtualPior } = resolveCurrentPrice(detail, pior!.row.sku);
    const precoOriginal = promo.original_price ?? precoAtualPior ?? detail.price ?? preco;
    const descontoPct = calcDescontoConsumidorPct(precoOriginal, preco);
    const { score } = calcScore(
      { descontoConsumidorPct: descontoPct, mlParticipacaoPct: mlPct, margemPct: pior!.margemFrac },
      ctx.weights,
    );
    evaluated.push({
      promo, preco, margemPct: pior!.margemFrac, skuReferencia: pior!.row.sku || null,
      descontoPct, mlPct, mlFonte, score, rejeitada: null, variacoes,
    });
  }

  const viaveis = evaluated.filter((e) => e.rejeitada === null);
  const melhor = viaveis.length > 0
    ? viaveis.reduce((best, cur) => (cur.score > best.score ? cur : best))
    : null;

  // A campanha em que o item JÁ está participando, lida ao vivo da API
  // (status "started"/"active"/etc.) — pode ou não ser a mesma que a
  // melhor pontuação atual. Comparar as duas é o que decide "trocar" ou
  // "manter".
  const ativaEntry = evaluated.find((e) => ACTIVE_STATUSES.has((e.promo.status ?? "").toLowerCase())) ?? null;

  let recomendada = melhor;
  let trocaFlag = false;
  let switchBlockedReason: string | null = null;
  if (ativaEntry && melhor && ativaEntry.promo.promotion_id !== melhor.promo.promotion_id) {
    const cfgAtiva = getCampaignTypeConfig(ativaEntry.promo.promotion_type);
    if (cfgAtiva.canDeleteAfterActive) {
      trocaFlag = true; // troca executável: sai da ativa, entra na nova
    } else if (ativaEntry.rejeitada === null) {
      // não dá pra sair da ativa (ex.: LIGHTNING/DOD) — mantém, mesmo a
      // outra pontuando mais.
      recomendada = ativaEntry;
      switchBlockedReason =
        `${melhor.promo.promotion_type} pontuaria mais (${melhor.score.toFixed(1)} x ${ativaEntry.score.toFixed(1)}), ` +
        `mas não é possível sair de ${ativaEntry.promo.promotion_type} depois de ativa (confirmado na doc oficial) — mantendo a atual.`;
    }
    // se a ativa está rejeitada (margem caiu abaixo do mínimo) e não dá
    // pra sair dela, `recomendada` continua sendo `melhor` (só
    // informativo — nenhuma gravação possível) e um aviso é anexado na
    // própria linha da ativa mais abaixo.
  }

  let escolhidas = 0;
  for (const e of evaluated) {
    const typeCfg = getCampaignTypeConfig(e.promo.promotion_type);
    const isEscolhida = recomendada !== null && e.promo.promotion_id === recomendada.promo.promotion_id;
    const isAtivaAtual = ativaEntry !== null && e.promo.promotion_id === ativaEntry.promo.promotion_id;
    const ehTroca = isEscolhida && trocaFlag && isEscolhida && !isAtivaAtual;
    const refTxt = e.skuReferencia ? ` (referência: SKU ${e.skuReferencia}, a de menor margem entre ${rows.length} variação(ões))` : "";

    let motivo: string;
    if (e.rejeitada) {
      motivo = `Rejeitada: ${e.rejeitada}`;
      if (isAtivaAtual && ativaEntry && !getCampaignTypeConfig(ativaEntry.promo.promotion_type).canDeleteAfterActive) {
        motivo += ` ATENÇÃO: esta campanha está ATIVA e não pode ser removida automaticamente (tipo não permite sair depois de ativa) — revise manualmente no painel do Mercado Livre.`;
      }
    } else if (ehTroca) {
      const deltaMargem = (e.margemPct - ativaEntry!.margemPct) * 100;
      const deltaDesconto = (e.descontoPct - ativaEntry!.descontoPct) * 100;
      motivo =
        `Troca recomendada: sair de ${ativaEntry!.promo.promotion_type} (margem ${(ativaEntry!.margemPct * 100).toFixed(1)}%, ` +
        `desconto ${(ativaEntry!.descontoPct * 100).toFixed(1)}%, score ${ativaEntry!.score.toFixed(1)}) e entrar em ${e.promo.promotion_type} ` +
        `(margem ${(e.margemPct * 100).toFixed(1)}%, desconto ${(e.descontoPct * 100).toFixed(1)}%, score ${e.score.toFixed(1)}) — ` +
        `margem ${deltaMargem >= 0 ? "+" : ""}${deltaMargem.toFixed(1)}pp, desconto ${deltaDesconto >= 0 ? "+" : ""}${deltaDesconto.toFixed(1)}pp.${refTxt}`;
    } else if (isEscolhida && isAtivaAtual && switchBlockedReason) {
      motivo = `Mantida (troca bloqueada): ${switchBlockedReason}${refTxt}`;
    } else if (isEscolhida && isAtivaAtual) {
      motivo = `Mantida: já é a melhor campanha disponível (score ${e.score.toFixed(1)})${refTxt} — nenhuma troca necessária.`;
    } else if (isEscolhida) {
      motivo =
        `Escolhida: melhor pontuação (${e.score.toFixed(1)}) entre ${viaveis.length} campanha(s) viável(is)${refTxt}` +
        (typeCfg.writeSupported ? "." : " — tipo sem gravação automática habilitada; aplique manualmente pelo painel do ML.");
    } else {
      motivo = `Válida (margem ${(e.margemPct * 100).toFixed(1)}%${refTxt}) mas superada por outra campanha com pontuação maior (${recomendada?.score.toFixed(1)}).`;
    }

    decisionRows.push({
      ...base,
      mlb,
      promotion_id: e.promo.promotion_id,
      promotion_type: e.promo.promotion_type,
      offer_id: e.promo.offer_id ?? null,
      preco_proposto: e.rejeitada ? null : e.preco,
      preco_original: e.promo.original_price ?? null,
      margem_calculada_pct: e.margemPct === -Infinity ? null : e.margemPct * 100,
      desconto_consumidor_pct: e.descontoPct * 100,
      ml_participacao_pct: e.mlPct != null ? e.mlPct * 100 : null,
      ml_participacao_fonte: e.mlFonte,
      reducao_tarifa:
        !!e.promo.boosted_offer ||
        e.promo.discount_meli_boosted_percentage != null ||
        e.promo.discount_meli_boost_amount != null,
      reducao_tarifa_pct: e.promo.discount_meli_boosted_percentage ?? null,
      reducao_tarifa_valor: e.promo.discount_meli_boost_amount ?? null,
      troca: ehTroca,
      campanha_anterior_id: ehTroca ? ativaEntry!.promo.promotion_id : null,
      campanha_anterior_tipo: ehTroca ? ativaEntry!.promo.promotion_type : null,
      campanha_anterior_offer_id: ehTroca ? ativaEntry!.promo.offer_id ?? null : null,
      campanha_anterior_margem_pct: ehTroca ? ativaEntry!.margemPct * 100 : null,
      campanha_anterior_score: ehTroca ? ativaEntry!.score : null,
      sku_referencia: e.skuReferencia,
      variacoes: e.variacoes,
      score: e.score,
      escolhida: isEscolhida,
      gravavel: isEscolhida && !isAtivaAtual && typeCfg.writeSupported,
      motivo,
      status: e.rejeitada ? "rejeitada" : "pendente",
    });
    if (isEscolhida) escolhidas++;
  }

  return { decisionRows, itemsCacheRow, logs, escolhidas };
}

// Orçamento de tempo por invocação — bem abaixo do maxDuration=60s da
// function (ver route.ts), com folga pra leitura inicial e resposta final.
// Catálogos grandes (visto na prática: quase 3 mil MLBs) não cabem numa
// invocação só — ao estourar o orçamento, a função para de propósito e
// devolve um evento "partial"; quem chama (UpdateButton) reconecta com o
// mesmo runId pra continuar de onde parou, em vez de a function ser
// cortada no meio silenciosamente (que é o que acontecia antes: MLBs que
// não coubessem no tempo simplesmente não ganhavam decisão nenhuma, sem
// nenhum aviso).
const TIME_BUDGET_MS = 45_000;

export async function* runUpdate(resumeRunId?: string): AsyncGenerator<ProgressEvent> {
  const startedAt = Date.now();
  const supabase = createServiceSupabase();

  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct")
    .eq("id", 1)
    .single();
  const settings = settingsRow as AppSettings;
  const weights: ScoreWeights = {
    pesoDesconto: settings.peso_desconto_pct / 100,
    pesoMl: settings.peso_ml_pct / 100,
    pesoMargem: settings.peso_margem_pct / 100,
  };
  const taxasPct = settings.taxas_pct / 100;

  const { data: itemConfigs, error: icErr } = await supabase
    .from("item_config")
    .select("mlb, sku, cmv, margem_minima_pct, margem_alvo_pct")
    .eq("participar_campanhas", true);
  if (icErr) {
    yield { type: "error", message: `Falha ao ler item_config: ${icErr.message}` };
    return;
  }
  const allRows = (itemConfigs ?? []) as ItemConfigRow[];
  if (allRows.length === 0) {
    yield { type: "error", message: "Nenhum item cadastrado em item_config (ou todos com participar_campanhas=false)." };
    return;
  }

  const byMlb = new Map<string, ItemConfigRow[]>();
  for (const row of allRows) {
    if (!byMlb.has(row.mlb)) byMlb.set(row.mlb, []);
    byMlb.get(row.mlb)!.push(row);
  }
  const totalMlbs = byMlb.size;

  const runId = resumeRunId ?? randomUUID();
  let jaProcessados = new Set<string>();
  if (resumeRunId) {
    const { data: done } = await supabase
      .from("campaign_decisions")
      .select("mlb")
      .eq("run_id", resumeRunId);
    jaProcessados = new Set((done ?? []).map((d) => d.mlb));
    yield {
      type: "log",
      message: `Retomando rodada ${resumeRunId} — ${jaProcessados.size}/${totalMlbs} MLBs já processados.`,
    };
  }
  const mlbs = [...byMlb.keys()].filter((mlb) => !jaProcessados.has(mlb));

  if (!resumeRunId) {
    yield {
      type: "log",
      message: `${totalMlbs} MLBs configurados (${allRows.length} linhas / variações no total). Conectando ao Mercado Livre...`,
    };
  }
  const client = await MercadoLivreClient.fromStore();
  const userId = await client.getUserId();
  const ctx: RunContext = { client, userId, taxasPct, weights, runId };

  let doneCount = jaProcessados.size;

  for (let i = 0; i < mlbs.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      yield { type: "partial", runId, done: doneCount, total: totalMlbs };
      return;
    }

    const batch = mlbs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((mlb) => processMlb(mlb, byMlb.get(mlb)!, ctx)));

    const allDecisionRows = results.flatMap((r) => r.decisionRows);
    const allItemsCacheRows = results.map((r) => r.itemsCacheRow).filter((r): r is Record<string, unknown> => r !== null);

    if (allItemsCacheRows.length > 0) {
      const { error } = await supabase.from("items_cache").upsert(allItemsCacheRows);
      if (error) yield { type: "log", message: `[aviso] falha ao gravar items_cache em lote: ${error.message}` };
    }
    if (allDecisionRows.length > 0) {
      const { error } = await supabase.from("campaign_decisions").insert(allDecisionRows);
      if (error) {
        yield { type: "error", message: `Falha ao gravar decisões do lote (MLBs ${batch.join(", ")}): ${error.message}` };
        return;
      }
    }

    for (const r of results) {
      for (const log of r.logs) yield { type: "log", message: log };
    }
    doneCount += batch.length;

    yield { type: "progress", done: doneCount, total: totalMlbs };
  }

  const { count: totalDecisions } = await supabase
    .from("campaign_decisions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId);
  const { count: totalEscolhidas } = await supabase
    .from("campaign_decisions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("escolhida", true);

  yield { type: "done", runId, totalDecisions: totalDecisions ?? 0, totalEscolhidas: totalEscolhidas ?? 0 };
}
