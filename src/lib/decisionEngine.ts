import { randomUUID } from "crypto";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { getCampaignTypeConfig } from "@/lib/mercadolivre/campaignTypes";
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
  sku: string | null;
  cmv: number;
  margem_minima_pct: number;
  margem_alvo_pct: number | null;
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
  const items = (itemConfigs ?? []) as ItemConfigRow[];
  if (items.length === 0) {
    yield { type: "error", message: "Nenhum item cadastrado em item_config (ou todos com participar_campanhas=false)." };
    return;
  }

  yield { type: "log", message: `${items.length} itens configurados. Conectando ao Mercado Livre...` };
  const client = await MercadoLivreClient.fromStore();
  const userId = await client.getUserId();

  yield { type: "log", message: "Buscando detalhes dos anúncios..." };
  const mlbs = items.map((i) => i.mlb);
  const detailsMap = await client.getItemsDetails(mlbs);

  const itemsCacheRows = mlbs
    .map((mlb) => {
      const d = detailsMap.get(mlb);
      if (!d) return null;
      return {
        mlb,
        title: d.title ?? null,
        category_id: d.category_id ?? null,
        price: d.price ?? null,
        sku: extractSku(d),
        listing_type_id: d.listing_type_id ?? null,
        shipping: d.shipping ?? null,
        status: d.status ?? null,
        fetched_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (itemsCacheRows.length > 0) {
    await supabase.from("items_cache").upsert(itemsCacheRows);
  }

  const runId = randomUUID();
  let totalDecisions = 0;
  let totalEscolhidas = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const cfg = items[idx];
    const detail = detailsMap.get(cfg.mlb);
    yield { type: "progress", done: idx, total: items.length };

    if (!detail) {
      await insertDecision(supabase, runId, {
        mlb: cfg.mlb,
        promotion_type: "-",
        motivo: "Não foi possível obter os detalhes do anúncio na API (item removido/inativo?).",
        status: "erro",
      });
      totalDecisions++;
      continue;
    }

    const [commission, freeShipping, promotions] = await Promise.all([
      client.getCommission(detail),
      client.getFreeShippingCost(userId, detail),
      client.getItemPromotions(cfg.mlb),
    ]);

    if (!commission.ok || commission.percentage_fee == null) {
      await insertDecision(supabase, runId, {
        mlb: cfg.mlb,
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
        mlb: cfg.mlb,
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
      margemPct: number;
      descontoPct: number;
      mlPct: number | null;
      mlFonte: string | null;
      score: number;
      rejeitada: string | null;
    }[] = [];

    for (const promo of promotions) {
      const typeCfg = getCampaignTypeConfig(promo.promotion_type);
      const precoOriginal = promo.original_price ?? detail.price ?? 0;
      const { pct: mlPct, fonte: mlFonte } = extractMlParticipacao(promo);
      const descontoTarifaPctFrac = mlFonte === "discount_meli_boosted_percentage" ? (mlPct ?? 0) : 0;
      const descontoTarifaValor = promo.discount_meli_boost_amount ?? 0;

      let preco: number;
      if (typeCfg.priceMode === "seller_defined") {
        const margemAlvoFrac = (cfg.margem_alvo_pct ?? cfg.margem_minima_pct) / 100;
        try {
          preco = calcPrecoParaMargem({
            cmv: cfg.cmv,
            freteMedio,
            taxasPct,
            comissaoPct,
            margemAlvoPct: margemAlvoFrac,
            descontoTarifaPct: descontoTarifaPctFrac,
          });
        } catch (e) {
          evaluated.push({
            promo, preco: 0, margemPct: -Infinity, descontoPct: 0, mlPct, mlFonte, score: 0,
            rejeitada: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        if (promo.min_discounted_price != null && preco < promo.min_discounted_price) {
          preco = promo.min_discounted_price;
        }
        if (promo.max_discounted_price != null && preco > promo.max_discounted_price) {
          preco = promo.max_discounted_price;
        }
      } else {
        preco = promo.total_price_for_boosted_offer ?? promo.price ?? 0;
        if (!preco) {
          evaluated.push({
            promo, preco: 0, margemPct: -Infinity, descontoPct: 0, mlPct, mlFonte, score: 0,
            rejeitada: "Campanha sem preço definido pela API e sem dados suficientes para calcular (tipo sem preço por item).",
          });
          continue;
        }
      }

      const margemFrac = calcMargemResultante({
        preco,
        cmv: cfg.cmv,
        freteMedio,
        comissaoPct,
        taxasPct,
        descontoTarifaValor,
      });
      const margemMinimaFrac = cfg.margem_minima_pct / 100;

      if (margemFrac < margemMinimaFrac) {
        evaluated.push({
          promo, preco, margemPct: margemFrac, descontoPct: 0, mlPct, mlFonte, score: 0,
          rejeitada: `Margem resultante ${(margemFrac * 100).toFixed(1)}% fica abaixo do mínimo de ${cfg.margem_minima_pct}%.`,
        });
        continue;
      }

      const descontoPct = calcDescontoConsumidorPct(precoOriginal, preco);
      const { score } = calcScore(
        { descontoConsumidorPct: descontoPct, mlParticipacaoPct: mlPct, margemPct: margemFrac },
        weights,
      );
      evaluated.push({ promo, preco, margemPct: margemFrac, descontoPct, mlPct, mlFonte, score, rejeitada: null });
    }

    const viaveis = evaluated.filter((e) => e.rejeitada === null);
    const melhor = viaveis.length > 0
      ? viaveis.reduce((best, cur) => (cur.score > best.score ? cur : best))
      : null;

    for (const e of evaluated) {
      const typeCfg = getCampaignTypeConfig(e.promo.promotion_type);
      const isEscolhida = melhor !== null && e.promo.promotion_id === melhor.promo.promotion_id;
      const motivo = e.rejeitada
        ? `Rejeitada: ${e.rejeitada}`
        : isEscolhida
          ? `Escolhida: melhor pontuação (${e.score.toFixed(1)}) entre ${viaveis.length} campanha(s) viável(is)` +
            (typeCfg.writeSupported ? "." : " — tipo sem gravação automática habilitada; aplique manualmente pelo painel do ML.")
          : `Válida (margem ${(e.margemPct * 100).toFixed(1)}%) mas superada por outra campanha com pontuação maior (${melhor?.score.toFixed(1)}).`;

      await insertDecision(supabase, runId, {
        mlb: cfg.mlb,
        promotion_id: e.promo.promotion_id,
        promotion_type: e.promo.promotion_type,
        offer_id: e.promo.offer_id ?? null,
        preco_proposto: e.rejeitada ? null : e.preco,
        preco_original: e.promo.original_price ?? null,
        margem_calculada_pct: e.margemPct === -Infinity ? null : e.margemPct * 100,
        desconto_consumidor_pct: e.descontoPct * 100,
        ml_participacao_pct: e.mlPct != null ? e.mlPct * 100 : null,
        ml_participacao_fonte: e.mlFonte,
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

  yield { type: "progress", done: items.length, total: items.length };
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
