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
} from "@/lib/scoring";
import type { ItemDetail, ItemPromotion } from "@/lib/mercadolivre/types";

export type ProgressEvent =
  | { type: "log"; message: string }
  | { type: "progress"; done: number; total: number }
  | { type: "done"; runId: string; totalDecisions: number; totalEscolhidas: number }
  | { type: "error"; message: string };

interface AppSettings {
  taxas_pct: number;
  peso_desconto_pct: number;
  peso_ml_pct: number;
  peso_margem_pct: number;
}

interface ItemConfigRow {
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

export async function* runUpdate(): AsyncGenerator<ProgressEvent> {
  const supabase = createServiceSupabase();

  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct")
    .eq("id", 1)
    .single();
  const settings = settingsRow as AppSettings;
  const weights = {
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
  const mlbs = [...byMlb.keys()];

  yield {
    type: "log",
    message: `${mlbs.length} MLBs configurados (${allRows.length} linhas / variações no total). Conectando ao Mercado Livre...`,
  };
  const client = await MercadoLivreClient.fromStore();
  const userId = await client.getUserId();

  const runId = randomUUID();
  let totalDecisions = 0;
  let totalEscolhidas = 0;

  for (let idx = 0; idx < mlbs.length; idx++) {
    const mlb = mlbs[idx];
    const rows = byMlb.get(mlb)!;
    yield { type: "progress", done: idx, total: mlbs.length };

    const detail = await client.getItemDetail(mlb);
    if (!detail) {
      await insertDecision(supabase, runId, {
        mlb,
        promotion_type: "-",
        motivo: "Não foi possível obter os detalhes do anúncio na API (item removido/inativo?).",
        status: "erro",
      });
      totalDecisions++;
      continue;
    }

    await supabase.from("items_cache").upsert({
      mlb,
      title: detail.title ?? null,
      category_id: detail.category_id ?? null,
      price: detail.price ?? null,
      sku: extractSku(detail),
      listing_type_id: detail.listing_type_id ?? null,
      shipping: detail.shipping ?? null,
      status: detail.status ?? null,
      fetched_at: new Date().toISOString(),
    });

    // Avisa (sem travar) quando um SKU cadastrado não bate com nenhuma
    // variação do anúncio — o cálculo cai pro preço do item inteiro, o que
    // pode não refletir o preço real daquela variação.
    for (const row of rows) {
      if (!row.sku) continue;
      const { skuEncontrado } = resolveCurrentPrice(detail, row.sku);
      if (!skuEncontrado) {
        yield {
          type: "log",
          message: `[aviso] ${mlb}: SKU '${row.sku}' não encontrado nas variações do anúncio — usando preço do item inteiro como aproximação.`,
        };
      }
    }

    const [commission, freeShipping, promotions] = await Promise.all([
      client.getCommission(detail),
      client.getFreeShippingCost(userId, detail),
      client.getItemPromotions(mlb),
    ]);

    if (!commission.ok || commission.percentage_fee == null) {
      await insertDecision(supabase, runId, {
        mlb,
        promotion_type: "-",
        motivo: `Não foi possível calcular a comissão (${commission.error ?? "sem detalhe"}) — item pulado.`,
        status: "erro",
      });
      totalDecisions++;
      continue;
    }
    const comissaoPct = commission.percentage_fee / 100;
    const freteMedio = freeShipping.ok ? freeShipping.list_cost ?? 0 : 0;

    if (promotions.length === 0) {
      await insertDecision(supabase, runId, {
        mlb,
        promotion_type: "-",
        motivo: "Nenhuma campanha candidata/ativa encontrada para este item.",
        status: "pendente",
      });
      totalDecisions++;
      continue;
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
      const priceCtx = { freteMedio, taxasPct, comissaoPct, descontoTarifaPct: descontoTarifaPctFrac };

      let preco: number;

      if (typeCfg.priceMode === "seller_defined") {
        // Um único deal_price vale pro MLB inteiro (confirmado: a API de
        // Promoções não aceita preço por variação) — usa o MAIOR preço
        // necessário entre as variações, garantindo que a de maior custo
        // também atinja sua margem-alvo (as mais baratas só lucram mais).
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

      // Margem resultante de CADA variação nesse preço único — a pior
      // decide se a campanha é segura pro MLB inteiro.
      const variacoes: VariacaoResultado[] = [];
      let pior: { row: ItemConfigRow; margemFrac: number } | null = null;
      let rejeitadaPorRow: string | null = null;
      for (const row of rows) {
        const margemFrac = calcMargemResultante({
          preco, cmv: row.cmv, freteMedio, comissaoPct, taxasPct, descontoTarifaValor,
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
        weights,
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

    for (const e of evaluated) {
      const typeCfg = getCampaignTypeConfig(e.promo.promotion_type);
      const isEscolhida = melhor !== null && e.promo.promotion_id === melhor.promo.promotion_id;
      const refTxt = e.skuReferencia ? ` (referência: SKU ${e.skuReferencia}, a de menor margem entre ${rows.length} variação(ões))` : "";
      const motivo = e.rejeitada
        ? `Rejeitada: ${e.rejeitada}`
        : isEscolhida
          ? `Escolhida: melhor pontuação (${e.score.toFixed(1)}) entre ${viaveis.length} campanha(s) viável(is)${refTxt}` +
            (typeCfg.writeSupported ? "." : " — tipo sem gravação automática habilitada; aplique manualmente pelo painel do ML.")
          : `Válida (margem ${(e.margemPct * 100).toFixed(1)}%${refTxt}) mas superada por outra campanha com pontuação maior (${melhor?.score.toFixed(1)}).`;

      await insertDecision(supabase, runId, {
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
        sku_referencia: e.skuReferencia,
        variacoes: e.variacoes,
        score: e.score,
        escolhida: isEscolhida,
        gravavel: isEscolhida && typeCfg.writeSupported,
        motivo,
        status: e.rejeitada ? "rejeitada" : "pendente",
      });
      totalDecisions++;
      if (isEscolhida) totalEscolhidas++;
    }
  }

  yield { type: "progress", done: mlbs.length, total: mlbs.length };
  yield { type: "done", runId, totalDecisions, totalEscolhidas };
}

function extractSku(item: ItemDetail): string | null {
  const fromItem = item.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  if (fromItem) return fromItem;
  const fromVariation = item.variations?.[0]?.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name;
  return fromVariation ?? null;
}

async function insertDecision(
  supabase: ReturnType<typeof createServiceSupabase>,
  runId: string,
  row: {
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
    sku_referencia?: string | null;
    variacoes?: VariacaoResultado[] | null;
    score?: number | null;
    escolhida?: boolean;
    gravavel?: boolean;
    motivo: string;
    status: string;
  },
) {
  const { error } = await supabase.from("campaign_decisions").insert({ ...row, run_id: runId });
  if (error) throw new Error(`Falha ao gravar decisão de ${row.mlb}: ${error.message}`);
}
