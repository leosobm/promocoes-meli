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
// campanha" — inclui "pending" (documentado como "aprovada e programada",
// ex.: LIGHTNING aceita mas aguardando a janela começar). Sem isso, uma
// oferta recém-aceita e ainda pending não era reconhecida como já ativa: o
// motor recalculava como se fosse nova adesão, e nessa hora a API já não
// devolve mais stock.min/max pra essa entrada (só remaining_stock),
// gerando stock_sugerido nulo e uma segunda tentativa de join falhando
// com "Stock must be greater than X and less than Y" (visto em produção).
const ACTIVE_STATUSES = new Set(["accepted", "active", "started", "joined", "in_progress", "pending"]);

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
  margem_tolerancia_pct: number;
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
  reducao_tarifa_fonte?: string | null;
  troca?: boolean;
  campanha_anterior_id?: string | null;
  campanha_anterior_tipo?: string | null;
  campanha_anterior_offer_id?: string | null;
  campanha_anterior_margem_pct?: number | null;
  campanha_anterior_score?: number | null;
  sku_referencia?: string | null;
  stock_sugerido?: number | null;
  variacoes?: VariacaoResultado[] | null;
  score?: number | null;
  escolhida?: boolean;
  gravavel?: boolean;
  dentro_tolerancia?: boolean;
  recomendacao?: string | null;
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
  toleranciaFrac: number; // 0.10 = 10% de tolerância sobre o piso de cada item
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

// Corte de segurança aplicado sobre o VALOR estimado de redução de tarifa
// (não sobre o percentual meli_percentage em si) ao estimar sem
// confirmação da API — ver chamado aberto com o suporte do Mercado Livre:
// boosted_offer/discount_meli_boost_amount não aparecem de forma
// confiável nem em ofertas já ativas, mas o painel mostra um valor de
// redução real desde antes da adesão. Testamos meli_percentage × preço
// original contra o painel em 9 casos reais: bateu exato em 2, ficou a
// poucos centavos em 6, e errou por R$0,32 em 1 (desvio de ~12%, o pior
// caso observado). Um corte de 1.5% sobre o valor NÃO cobre esse pior
// caso (ainda superestimaria por ~10% nele) — decisão consciente de
// aceitar esse risco residual em troca de mais precisão nos demais casos.
const GORDURA_VALOR_FRAC = 0.015;

interface TarifaReducaoEstimada {
  valor: number;
  pctFrac: number;
  fonte: "api_confirmada" | "estimada_meli_percentage";
}

/** Redução de tarifa (comissão) de uma oferta: usa o valor exato da API
 * quando presente (discount_meli_boost_amount); na ausência dele, estima
 * a partir de meli_percentage com o corte de segurança acima. Retorna
 * null quando não há nenhum sinal de redução (nem exato nem estimável). */
function estimarReducaoTarifa(promo: ItemPromotion): TarifaReducaoEstimada | null {
  if (promo.discount_meli_boost_amount != null) {
    return {
      valor: promo.discount_meli_boost_amount,
      pctFrac: (promo.discount_meli_boosted_percentage ?? 0) / 100,
      fonte: "api_confirmada",
    };
  }
  const meliPct = promo.meli_percentage ?? promo.benefits?.meli_percent ?? null;
  if (meliPct == null || promo.original_price == null) return null;
  const valorBruto = (meliPct / 100) * promo.original_price;
  const valor = valorBruto * (1 - GORDURA_VALOR_FRAC);
  return {
    valor,
    pctFrac: valor / promo.original_price,
    fonte: "estimada_meli_percentage",
  };
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
  const base = {
    run_id: ctx.runId, escolhida: false, gravavel: false, reducao_tarifa: false, troca: false,
    dentro_tolerancia: false, recomendacao: "sem_dados",
  };

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
    margemAoVivoPct: number | null; // pior margem NO PREÇO VIGENTE, só quando a campanha já está ativa (pra comparar antes/depois)
    skuReferencia: string | null;
    descontoPct: number;
    mlPct: number | null;
    mlFonte: string | null;
    score: number;
    rejeitada: string | null;
    variacoes: VariacaoResultado[] | null;
    stockSugerido: number | null;
  }[] = [];

  for (const promo of promotions) {
    const typeCfg = getCampaignTypeConfig(promo.promotion_type);
    const { pct: mlPct, fonte: mlFonte } = extractMlParticipacao(promo);
    const tarifaEstimada = estimarReducaoTarifa(promo);
    const descontoTarifaPctFrac = tarifaEstimada?.pctFrac ?? 0;
    const descontoTarifaValor = tarifaEstimada?.valor ?? 0;
    const priceCtx = { freteMedio, taxasPct: ctx.taxasPct, comissaoPct, descontoTarifaPct: descontoTarifaPctFrac };

    // LIGHTNING exige reservar um "stock" no join, dentro de uma faixa
    // ABERTA (exclusiva nas duas pontas) devolvida pela própria API — a
    // mensagem de erro real é literal: "Stock must be greater than X and
    // less than Y", ou seja, min e max NÃO são valores aceitos, só o que
    // fica estritamente entre eles (visto na prática: min=5 rejeitou com
    // stock=5, só aceitou a partir de 6). Reserva o mínimo utilizável
    // (min + 1), não o estoque disponível inteiro — deixa o resto livre
    // pra venda normal fora da oferta relâmpago. Rejeita de cara quando
    // nem esse mínimo cabe no estoque disponível ou quando a faixa é
    // estreita demais pra ter algum valor válido no meio.
    let stockSugerido: number | null = null;
    let estoqueInsuficiente: string | null = null;
    if (typeCfg.extraJoinFields === "stock") {
      const min = promo.stock?.min ?? null;
      const max = promo.stock?.max ?? null;
      const disponivel = detail.available_quantity ?? null;
      if (min != null && max != null && disponivel != null) {
        const minUtilizavel = min + 1;
        if (minUtilizavel >= max) {
          estoqueInsuficiente = `Faixa de estoque da campanha (entre ${min} e ${max}, exclusive) não deixa nenhum valor válido.`;
        } else if (disponivel < minUtilizavel) {
          estoqueInsuficiente = `Estoque disponível do anúncio (${disponivel}) é menor que o mínimo utilizável pela campanha (${minUtilizavel}, já que ${min} não é aceito) — não é possível aderir.`;
        } else {
          stockSugerido = minUtilizavel;
        }
      }
    }
    if (estoqueInsuficiente) {
      evaluated.push({
        promo, preco: 0, margemPct: -Infinity, margemAoVivoPct: null, skuReferencia: null, descontoPct: 0,
        mlPct, mlFonte, score: 0, rejeitada: estoqueInsuficiente, variacoes: null, stockSugerido: null,
      });
      continue;
    }

    let preco: number;
    let margemAoVivoPct: number | null = null;

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
          promo, preco: 0, margemPct: -Infinity, margemAoVivoPct: null, skuReferencia: null, descontoPct: 0,
          mlPct, mlFonte, score: 0, rejeitada: erroImpossivel, variacoes: null, stockSugerido,
        });
        continue;
      }
      preco = maiorPreco;
      if (promo.min_discounted_price != null && preco < promo.min_discounted_price) preco = promo.min_discounted_price;
      if (promo.max_discounted_price != null && preco > promo.max_discounted_price) preco = promo.max_discounted_price;

      // Campanha já ATIVA (status ao vivo) e tipo onde o vendedor define o
      // preço: só recomenda MUDAR o preço vigente se (a) ele já não estiver
      // mais seguro (margem caiu abaixo do mínimo de alguma variação) ou
      // (b) o preço recém-calculado for MENOR (mais atrativo ao cliente) —
      // nunca sobe o preço de volta só porque a fórmula "quer" um valor
      // maior, se o que já está lá continua dentro dos parâmetros.
      if (ACTIVE_STATUSES.has((promo.status ?? "").toLowerCase())) {
        const precoAoVivo = promo.total_price_for_boosted_offer ?? promo.price ?? null;
        if (precoAoVivo != null) {
          let piorAoVivo = Infinity;
          let aoVivoSeguro = true;
          for (const row of rows) {
            const m = calcMargemResultante({
              preco: precoAoVivo, cmv: row.cmv, freteMedio, comissaoPct,
              taxasPct: ctx.taxasPct, descontoTarifaValor: tarifaEstimada?.valor ?? 0,
            });
            if (m < piorAoVivo) piorAoVivo = m;
            if (m < row.margem_minima_pct / 100) aoVivoSeguro = false;
          }
          margemAoVivoPct = piorAoVivo * 100;
          if (aoVivoSeguro && precoAoVivo <= preco) {
            preco = precoAoVivo; // mantém — já é bom e pelo menos tão atrativo quanto o calculado
          }
          // senão: preco continua sendo o alvo calculado (ou porque o
          // vigente não é mais seguro, ou porque o alvo é mais atrativo)
        }
      }
    } else {
      preco = promo.total_price_for_boosted_offer ?? promo.price ?? 0;
      if (!preco) {
        evaluated.push({
          promo, preco: 0, margemPct: -Infinity, margemAoVivoPct: null, skuReferencia: null, descontoPct: 0,
          mlPct, mlFonte, score: 0,
          rejeitada: "Campanha sem preço definido pela API e sem dados suficientes para calcular (tipo sem preço por item).",
          variacoes: null, stockSugerido,
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

    // Desconto/score calculados sempre (mesmo quando rejeitada) — usado
    // pra ranquear candidatos de tolerância quando não há nenhuma opção
    // dentro do piso estrito (ver bloco de tolerância mais abaixo).
    const { price: precoAtualPior } = resolveCurrentPrice(detail, pior!.row.sku);
    const precoOriginal = promo.original_price ?? precoAtualPior ?? detail.price ?? preco;
    const descontoPct = calcDescontoConsumidorPct(precoOriginal, preco);
    const { score } = calcScore(
      { descontoConsumidorPct: descontoPct, mlParticipacaoPct: mlPct, margemPct: pior!.margemFrac },
      ctx.weights,
    );

    if (rejeitadaPorRow) {
      evaluated.push({
        promo, preco, margemPct: pior!.margemFrac, margemAoVivoPct, skuReferencia: pior!.row.sku || null,
        descontoPct, mlPct, mlFonte, score, rejeitada: rejeitadaPorRow, variacoes, stockSugerido,
      });
      continue;
    }

    evaluated.push({
      promo, preco, margemPct: pior!.margemFrac, margemAoVivoPct, skuReferencia: pior!.row.sku || null,
      descontoPct, mlPct, mlFonte, score, rejeitada: null, variacoes, stockSugerido,
    });
  }

  const viaveis = evaluated.filter((e) => e.rejeitada === null);

  // A campanha em que o item JÁ está participando, lida ao vivo da API
  // (status "started"/"active"/etc.) — pode ou não ser a mesma que a
  // melhor pontuação atual. Precisa vir ANTES de `melhor` porque as duas
  // regras de negócio abaixo (bloqueio de troca pra SELLER_CAMPAIGN e
  // priorização de PRE_NEGOTIATED) dependem de saber qual campanha já
  // está ativa.
  const ativaEntry = evaluated.find((e) => ACTIVE_STATUSES.has((e.promo.status ?? "").toLowerCase())) ?? null;

  // Regra de negócio: só recomenda TROCAR de campanha pra SELLER_CAMPAIGN
  // quando a margem da campanha ativa já caiu abaixo do tolerável (nem a
  // tolerância configurada segura mais) — SELLER_CAMPAIGN não deve "roubar"
  // uma troca só por pontuar mais enquanto a ativa ainda está numa margem
  // aceitável. Não afeta nova adesão (sem campanha ativa) nem quando a
  // própria ativa já é SELLER_CAMPAIGN.
  const margemAtivaAoVivo = ativaEntry ? ativaEntry.margemAoVivoPct ?? ativaEntry.margemPct * 100 : null;
  const pisoToleradoMaisExigente = Math.max(...rows.map((row) => row.margem_minima_pct * (1 - ctx.toleranciaFrac)));
  const ativaAbaixoDoTolerable = margemAtivaAoVivo != null && margemAtivaAoVivo < pisoToleradoMaisExigente;
  const bloquearSellerCampaignComoTroca =
    ativaEntry !== null && ativaEntry.promo.promotion_type !== "SELLER_CAMPAIGN" && !ativaAbaixoDoTolerable;
  const poolMelhor = bloquearSellerCampaignComoTroca
    ? viaveis.filter((e) => e.promo.promotion_type !== "SELLER_CAMPAIGN")
    : viaveis;

  // Regra de negócio: PRE_NEGOTIATED é um desconto pré-acordado direto com
  // o Mercado Livre — sempre que houver uma oferta viável desse tipo, ela
  // deve ser a sugestão de adesão, independente de pontuar menos que outra
  // campanha.
  const preNegociadasViaveis = poolMelhor.filter((e) => e.promo.promotion_type === "PRE_NEGOTIATED");
  const melhor = preNegociadasViaveis.length > 0
    ? preNegociadasViaveis.reduce((best, cur) => (cur.score > best.score ? cur : best))
    : poolMelhor.length > 0
      ? poolMelhor.reduce((best, cur) => (cur.score > best.score ? cur : best))
      : null;

  // Sem NENHUMA campanha dentro do piso estrito: procura a melhor opção
  // que caia dentro da TOLERÂNCIA configurada (todas as variações do item
  // acima do piso*[1-tolerância], não só a estrita) — vira uma
  // "oportunidade abaixo do piso" pra opt-in manual, nunca escolhida
  // automaticamente. Ignora candidatas com erro de cálculo (sem variacoes).
  let melhorTolerancia: (typeof evaluated)[number] | null = null;
  if (melhor === null && ctx.toleranciaFrac > 0) {
    const candidatosTolerancia = evaluated.filter((e) => {
      if (e.rejeitada === null || !e.variacoes) return false;
      if (ACTIVE_STATUSES.has((e.promo.status ?? "").toLowerCase())) return false; // já ativa — nada pra "opt-in"
      return rows.every((row) => {
        const v = e.variacoes!.find((vv) => vv.sku === (row.sku || null));
        if (!v || v.margem_calculada_pct == null) return false;
        const pisoTolerado = row.margem_minima_pct * (1 - ctx.toleranciaFrac);
        return v.margem_calculada_pct >= pisoTolerado;
      });
    });
    melhorTolerancia = candidatosTolerancia.length > 0
      ? candidatosTolerancia.reduce((best, cur) => (cur.score > best.score ? cur : best))
      : null;
  }

  let recomendada = melhor;
  let trocaFlag = false;
  let atualizaPrecoMesmaCampanha = false;
  let switchBlockedReason: string | null = null;
  if (ativaEntry && melhor) {
    const mesmaCampanha = ativaEntry.promo.promotion_id === melhor.promo.promotion_id;
    const cfgAtiva = getCampaignTypeConfig(ativaEntry.promo.promotion_type);

    if (mesmaCampanha) {
      // Mesma campanha — só é preciso agir se o preço calculado (`melhor.
      // preco`) difere do preço realmente vigente na API. A comparação
      // "manter o preço ao vivo se ele já for seguro e pelo menos tão
      // atrativo" já aconteceu na hora de montar `evaluated` (preco só
      // vira o alvo calculado quando o vigente não serve mais ou o alvo é
      // menor) — então basta comparar `melhor.preco` com o preço ao vivo.
      const precoAoVivo = ativaEntry.promo.total_price_for_boosted_offer ?? ativaEntry.promo.price ?? null;
      const precisaAtualizar = precoAoVivo != null && Math.abs(melhor.preco - precoAoVivo) > 0.01;
      if (precisaAtualizar) {
        if (cfgAtiva.canDeleteAfterActive) {
          trocaFlag = true;
          atualizaPrecoMesmaCampanha = true; // sai e reentra na MESMA campanha, só com preço novo
        } else {
          switchBlockedReason =
            `Preço ideal seria R$ ${melhor.preco.toFixed(2)} (vigente: R$ ${precoAoVivo!.toFixed(2)}), mas não é possível ` +
            `alterar o preço de ${ativaEntry.promo.promotion_type} depois de ativa (confirmado na doc oficial) — mantendo o vigente.`;
        }
      }
      // senão: preço vigente já está bom (seguro e pelo menos tão
      // atrativo quanto o calculado) — nenhuma ação, "Mantida" de verdade.
    } else {
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
  }

  let escolhidas = 0;
  for (const e of evaluated) {
    const typeCfg = getCampaignTypeConfig(e.promo.promotion_type);
    const isEscolhida = recomendada !== null && e.promo.promotion_id === recomendada.promo.promotion_id;
    const isAtivaAtual = ativaEntry !== null && e.promo.promotion_id === ativaEntry.promo.promotion_id;
    const ehTroca = isEscolhida && trocaFlag;
    const ehAtualizacaoDePreco = ehTroca && isAtivaAtual && atualizaPrecoMesmaCampanha;
    const ehTolerancia = melhorTolerancia !== null && e.promo.promotion_id === melhorTolerancia.promo.promotion_id;
    const refTxt = e.skuReferencia ? ` (referência: SKU ${e.skuReferencia}, a de menor margem entre ${rows.length} variação(ões))` : "";
    const tarifaEstimada = estimarReducaoTarifa(e.promo);

    let motivo: string;
    if (ehTolerancia) {
      motivo =
        `Abaixo do piso de margem, mas DENTRO DA TOLERÂNCIA configurada (${(ctx.toleranciaFrac * 100).toFixed(0)}%): ` +
        `margem resultante ${(e.margemPct * 100).toFixed(1)}%${refTxt}. Não foi escolhida automaticamente — requer sua aprovação manual explícita.`;
    } else if (e.rejeitada) {
      motivo = `Rejeitada: ${e.rejeitada}`;
      if (isAtivaAtual && ativaEntry && !getCampaignTypeConfig(ativaEntry.promo.promotion_type).canDeleteAfterActive) {
        motivo += ` ATENÇÃO: esta campanha está ATIVA e não pode ser removida automaticamente (tipo não permite sair depois de ativa) — revise manualmente no painel do Mercado Livre.`;
      }
    } else if (ehAtualizacaoDePreco) {
      const precoAoVivo = ativaEntry!.promo.total_price_for_boosted_offer ?? ativaEntry!.promo.price ?? null;
      const margemAntes = ativaEntry!.margemAoVivoPct ?? ativaEntry!.margemPct * 100;
      const direcao = precoAoVivo != null && e.preco < precoAoVivo ? "mais atrativo ao cliente" : "necessário pra manter a margem mínima";
      motivo =
        `Atualização de preço recomendada: campanha ${e.promo.promotion_type} já ativa com preço vigente ` +
        `R$ ${precoAoVivo?.toFixed(2) ?? "?"} (margem ${margemAntes.toFixed(1)}%) — novo preço R$ ${e.preco.toFixed(2)} ` +
        `(margem ${(e.margemPct * 100).toFixed(1)}%) é ${direcao}.${refTxt}`;
    } else if (ehTroca) {
      const margemAntesTroca = ativaEntry!.margemAoVivoPct ?? ativaEntry!.margemPct * 100;
      const deltaMargem = e.margemPct * 100 - margemAntesTroca;
      const deltaDesconto = (e.descontoPct - ativaEntry!.descontoPct) * 100;
      const precoAoVivoTroca = ativaEntry!.promo.total_price_for_boosted_offer ?? ativaEntry!.promo.price ?? null;
      const ehDiminuicaoTroca = precoAoVivoTroca != null && e.preco < precoAoVivoTroca;
      // Preço menor: não precisa sair da anterior — a nova (mais barata)
      // já prevalece sozinha (o ML mostra o menor preço entre as ofertas
      // ativas do item), e a anterior fica como "backup" pra retomar
      // automaticamente quando a nova expirar (pensado pra LIGHTNING, de
      // curta duração). Preço maior: só sair da anterior faz a nova
      // realmente entrar em vigor, já que a anterior (mais barata)
      // continuaria prevalecendo se ficasse ativa junto.
      const mecanismo = ehDiminuicaoTroca
        ? `mantém ${ativaEntry!.promo.promotion_type} ativa como backup (retoma sozinha quando a nova expirar) e entra em`
        : `sai de ${ativaEntry!.promo.promotion_type} e entra em`;
      motivo =
        `Troca recomendada: ${mecanismo} ${e.promo.promotion_type} ` +
        `(margem ${(e.margemPct * 100).toFixed(1)}%, desconto ${(e.descontoPct * 100).toFixed(1)}%, score ${e.score.toFixed(1)}) — ` +
        `vinha de ${ativaEntry!.promo.promotion_type} (margem ${margemAntesTroca.toFixed(1)}%, ` +
        `desconto ${(ativaEntry!.descontoPct * 100).toFixed(1)}%, score ${ativaEntry!.score.toFixed(1)}), ` +
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

    // Nem troca de campanha nem nova adesão são categorias de movimentação
    // próprias — as duas são só o mecanismo por trás de um aumento ou
    // diminuição de preço. Troca compara com o preço ao vivo da campanha
    // anterior; nova adesão (sem nenhuma campanha ativa antes) compara com
    // o preço regular do item (fora de campanha).
    let recomendacao: string;
    if (ehTolerancia) recomendacao = "tolerancia";
    else if (e.rejeitada) recomendacao = "rejeitada";
    else if (ehTroca) {
      const precoAoVivo = ativaEntry!.promo.total_price_for_boosted_offer ?? ativaEntry!.promo.price ?? null;
      recomendacao = precoAoVivo != null && e.preco < precoAoVivo ? "diminuir_preco" : "aumentar_preco";
    } else if (isEscolhida && isAtivaAtual) recomendacao = "mantida";
    else if (isEscolhida) {
      const precoRegular = e.promo.original_price ?? detail.price ?? null;
      recomendacao = precoRegular != null && e.preco < precoRegular ? "diminuir_preco" : "aumentar_preco";
    } else recomendacao = "superada";

    const statusFinal = ehTolerancia ? "tolerancia" : e.rejeitada ? "rejeitada" : "pendente";

    decisionRows.push({
      ...base,
      mlb,
      promotion_id: e.promo.promotion_id,
      promotion_type: e.promo.promotion_type,
      offer_id: e.promo.offer_id ?? null,
      preco_proposto: e.rejeitada && !ehTolerancia ? null : e.preco,
      preco_original: e.promo.original_price ?? null,
      margem_calculada_pct: e.margemPct === -Infinity ? null : e.margemPct * 100,
      desconto_consumidor_pct: e.descontoPct * 100,
      ml_participacao_pct: e.mlPct != null ? e.mlPct * 100 : null,
      ml_participacao_fonte: e.mlFonte,
      reducao_tarifa: !!e.promo.boosted_offer || tarifaEstimada !== null,
      reducao_tarifa_pct: tarifaEstimada ? tarifaEstimada.pctFrac * 100 : null,
      reducao_tarifa_valor: tarifaEstimada?.valor ?? null,
      reducao_tarifa_fonte: tarifaEstimada?.fonte ?? null,
      troca: ehTroca,
      campanha_anterior_id: ehTroca ? ativaEntry!.promo.promotion_id : null,
      campanha_anterior_tipo: ehTroca ? ativaEntry!.promo.promotion_type : null,
      campanha_anterior_offer_id: ehTroca ? ativaEntry!.promo.offer_id ?? null : null,
      campanha_anterior_margem_pct: ehTroca ? ativaEntry!.margemAoVivoPct ?? ativaEntry!.margemPct * 100 : null,
      campanha_anterior_score: ehTroca && !ehAtualizacaoDePreco ? ativaEntry!.score : null,
      sku_referencia: e.skuReferencia,
      stock_sugerido: e.stockSugerido,
      variacoes: e.variacoes,
      score: e.score,
      escolhida: isEscolhida,
      gravavel: ehTolerancia ? typeCfg.writeSupported : typeCfg.writeSupported && (ehTroca || (isEscolhida && !isAtivaAtual)),
      dentro_tolerancia: ehTolerancia,
      recomendacao,
      motivo,
      status: statusFinal,
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

export async function* runUpdate(
  resumeRunId?: string,
  apenasAtivos?: boolean,
): AsyncGenerator<ProgressEvent> {
  const startedAt = Date.now();
  const supabase = createServiceSupabase();

  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct, margem_tolerancia_pct")
    .eq("id", 1)
    .single();
  const settings = settingsRow as AppSettings;
  const weights: ScoreWeights = {
    pesoDesconto: settings.peso_desconto_pct / 100,
    pesoMl: settings.peso_ml_pct / 100,
    pesoMargem: settings.peso_margem_pct / 100,
  };
  const taxasPct = settings.taxas_pct / 100;
  const toleranciaFrac = settings.margem_tolerancia_pct / 100;

  // O Supabase/PostgREST limita cada resposta a 1000 linhas por padrão —
  // sem paginação explícita, um catálogo grande (visto na prática: 2891
  // itens) tem a maior parte silenciosamente ignorada, sem erro nenhum.
  // Pagina em blocos de 1000 com ORDER BY estável (mlb, sku) até esgotar.
  const allRows: ItemConfigRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: icErr } = await supabase
      .from("item_config")
      .select("mlb, sku, cmv, margem_minima_pct, margem_alvo_pct")
      .eq("participar_campanhas", true)
      .order("mlb", { ascending: true })
      .order("sku", { ascending: true })
      .range(from, from + 999);
    if (icErr) {
      yield { type: "error", message: `Falha ao ler item_config: ${icErr.message}` };
      return;
    }
    if (!page || page.length === 0) break;
    allRows.push(...(page as ItemConfigRow[]));
    if (page.length < 1000) break;
  }
  if (allRows.length === 0) {
    yield { type: "error", message: "Nenhum item cadastrado em item_config (ou todos com participar_campanhas=false)." };
    return;
  }

  const byMlb = new Map<string, ItemConfigRow[]>();
  for (const row of allRows) {
    if (!byMlb.has(row.mlb)) byMlb.set(row.mlb, []);
    byMlb.get(row.mlb)!.push(row);
  }

  // "Apenas itens ativos" = anúncio com status "active" no Mercado Livre
  // (não pausado/fechado) — usa o cache de rodadas anteriores
  // (items_cache.status) em vez de consultar a API antes de decidir o que
  // processar. Itens nunca sincronizados (sem linha em items_cache) ficam
  // de fora desse filtro — rode "todos" pelo menos uma vez pra populá-los.
  if (apenasAtivos) {
    const todosMlbs = [...byMlb.keys()];
    const ativos = new Set<string>();
    for (let i = 0; i < todosMlbs.length; i += 1000) {
      const bloco = todosMlbs.slice(i, i + 1000);
      const { data: page } = await supabase
        .from("items_cache")
        .select("mlb, status")
        .in("mlb", bloco)
        .eq("status", "active");
      for (const it of page ?? []) ativos.add(it.mlb);
    }
    for (const mlb of todosMlbs) {
      if (!ativos.has(mlb)) byMlb.delete(mlb);
    }
  }
  const totalMlbs = byMlb.size;
  if (apenasAtivos && totalMlbs === 0) {
    yield {
      type: "error",
      message: "Nenhum item ativo encontrado no cache (rode 'todos os itens' pelo menos uma vez antes de usar este filtro).",
    };
    return;
  }

  const runId = resumeRunId ?? randomUUID();
  let jaProcessados = new Set<string>();
  if (resumeRunId) {
    // Mesmo problema do fetch de item_config: uma rodada grande gera muito
    // mais de 1000 linhas em campaign_decisions (várias por MLB) — sem
    // paginar, a maioria dos MLBs já processados não aparecia aqui, e a
    // função tentava reprocessar (e duplicar decisões para) itens que já
    // tinham acabado de ser calculados nesta mesma rodada.
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase
        .from("campaign_decisions")
        .select("mlb")
        .eq("run_id", resumeRunId)
        .range(from, from + 999);
      if (!page || page.length === 0) break;
      for (const d of page) jaProcessados.add(d.mlb);
      if (page.length < 1000) break;
    }
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
  const ctx: RunContext = { client, userId, taxasPct, toleranciaFrac, weights, runId };

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
