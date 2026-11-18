import { randomUUID } from "crypto";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { getCampaignTypeConfig } from "@/lib/mercadolivre/campaignTypes";
import { arredondarPrecoPsicologico, calcMargemResultante } from "@/lib/scoring";
import type { ItemPromotion, PriceToWin } from "@/lib/mercadolivre/types";
import { BOOST_CATALOGO, MOTIVO_CATALOGO, rotuloBoost } from "@/lib/catalogLabels";
import { atualizarGmvNaRodada } from "@/lib/gmv";
import {
  ACTIVE_STATUSES,
  calcStockSugerido,
  carregarUniverso,
  criarFretePorPreco,
  estimarReducaoTarifa,
  mlbsAtivosNoCache,
  montarItemsCacheRow,
  type ItemConfigRow,
  type ProgressEvent,
} from "@/lib/decisionEngine";

const CONCURRENCY = 10;
const TIME_BUDGET_MS = 45_000;

// VOLUME e cupom não têm preço por item (desconto no carrinho). BANK é
// desconto só no Pix — sem confirmação de que conte pro preço que disputa
// o catálogo, fica de fora por segurança em vez de sugerir uma adesão que
// talvez não mova o buybox.
const TIPOS_SEM_EFEITO_NO_BUYBOX = new Set(["BANK", "VOLUME", "SELLER_COUPON_CAMPAIGN"]);

type Situacao = "ganhando" | "preco" | "outro_motivo" | "nao_catalogo" | "erro";

interface CatalogInsertRow {
  run_id: string;
  mlb: string;
  situacao: Situacao;
  motivo: string;
  status: "info" | "pendente" | "erro";
  gravavel: boolean;
  troca: boolean;
  status_competicao?: string | null;
  motivos_ml?: string[] | null;
  boosts_faltantes?: string[] | null;
  orientacao?: string | null;
  catalog_product_id?: string | null;
  vencedor_item_id?: string | null;
  vencedor_preco?: number | null;
  preco_atual?: number | null;
  preco_para_ganhar?: number | null;
  preco_sugerido?: number | null;
  margem_sem_incentivo_pct?: number | null;
  margem_minima_pct?: number | null;
  incentivo_necessario_valor?: number | null;
  incentivo_necessario_pct?: number | null;
  sku_referencia?: string | null;
  promotion_id?: string | null;
  promotion_type?: string | null;
  offer_id?: string | null;
  preco_proposto?: number | null;
  margem_campanha_pct?: number | null;
  reducao_tarifa_valor?: number | null;
  reducao_tarifa_fonte?: string | null;
  stock_sugerido?: number | null;
  campanha_anterior_id?: string | null;
  campanha_anterior_tipo?: string | null;
  campanha_anterior_offer_id?: string | null;
}

interface CatalogContext {
  client: MercadoLivreClient;
  userId: number;
  taxasPct: number;
  runId: string;
}

interface CampanhaCandidata {
  promo: ItemPromotion;
  preco: number;
  margem: number; // pior variação, fração
  tarifa: ReturnType<typeof estimarReducaoTarifa>;
  stock: number | null;
  mesmaCampanhaAtiva: boolean;
}

function brl(v: number): string {
  return `R$ ${v.toFixed(2)}`;
}

/** Benefícios que o vencedor tem ativos ("boosted") e este anúncio não
 * ("opportunity") — é o que explica perder sem ser por preço. */
function calcBoostsFaltantes(ptw: PriceToWin): string[] {
  const meus = new Map((ptw.boosts ?? []).map((b) => [b.id, b.status]));
  return (ptw.winner?.boosts ?? [])
    .filter((b) => b.status === "boosted" && meus.get(b.id) === "opportunity")
    .map((b) => b.id);
}

function montarOrientacao(ptw: PriceToWin, boostsFaltantes: string[]): string {
  const partes: string[] = [];
  for (const r of ptw.reason ?? []) {
    const m = MOTIVO_CATALOGO[r];
    partes.push(m ? `${m.rotulo}. ${m.orientacao}` : `Motivo informado pelo ML ainda sem tradução: "${r}".`);
  }
  if (boostsFaltantes.length > 0) {
    partes.push(
      `O vencedor tem ${boostsFaltantes.map(rotuloBoost).join(", ")} e você não — ` +
        `${boostsFaltantes.map((b) => BOOST_CATALOGO[b]?.acao ?? b).join("; ")}.`,
    );
  }
  if (partes.length === 0) {
    partes.push("O ML não indica um preço menor que resolva nem um motivo específico — confira o anúncio no painel do ML.");
  }
  return partes.join(" ");
}

export async function processCatalogMlb(
  mlb: string,
  rows: ItemConfigRow[],
  ctx: CatalogContext,
): Promise<{ row: CatalogInsertRow; itemsCacheRow: Record<string, unknown> | null }> {
  const base = { run_id: ctx.runId, mlb, gravavel: false, troca: false, status: "info" as const };

  const detail = await ctx.client.getItemDetail(mlb);
  if (!detail) {
    return {
      row: { ...base, situacao: "erro", status: "erro", motivo: "Não foi possível obter os detalhes do anúncio na API." },
      itemsCacheRow: null,
    };
  }
  const itemsCacheRow = montarItemsCacheRow(mlb, detail);
  if (!detail.catalog_listing) {
    return { row: { ...base, situacao: "nao_catalogo", motivo: "Anúncio tradicional (não é de catálogo)." }, itemsCacheRow };
  }

  const ptwRes = await ctx.client.getPriceToWin(mlb);
  if (!ptwRes.ok) {
    return {
      row: { ...base, situacao: "erro", status: "erro", motivo: `Falha ao consultar a competição no catálogo: ${ptwRes.error}` },
      itemsCacheRow,
    };
  }
  const ptw = ptwRes.data;
  const motivosMl = ptw.reason ?? [];
  const boostsFaltantes = calcBoostsFaltantes(ptw);
  const comum = {
    ...base,
    status_competicao: ptw.status,
    motivos_ml: motivosMl,
    boosts_faltantes: boostsFaltantes,
    catalog_product_id: ptw.catalog_product_id ?? detail.catalog_product_id ?? null,
    vencedor_item_id: ptw.winner?.item_id ?? null,
    vencedor_preco: ptw.winner?.price ?? null,
    preco_atual: ptw.current_price,
    preco_para_ganhar: ptw.price_to_win,
  };

  if (ptw.status === "winning") {
    return { row: { ...comum, situacao: "ganhando", motivo: "Ganhando o catálogo." }, itemsCacheRow };
  }

  // Só é "preço" quando o ML não aponta nenhum motivo E indica um preço
  // menor que o atual. Qualquer reason (inclusive no_improvement_price,
  // fora da doc, em que price_to_win = preço atual) é outra coisa.
  const ehPreco =
    motivosMl.length === 0 &&
    ptw.price_to_win != null &&
    ptw.current_price != null &&
    ptw.price_to_win < ptw.current_price - 0.005;
  if (!ehPreco) {
    const rotulos = motivosMl.map((r) => MOTIVO_CATALOGO[r]?.rotulo ?? r);
    if (boostsFaltantes.length > 0) rotulos.push(`vencedor com ${boostsFaltantes.map(rotuloBoost).join(", ")}`);
    return {
      row: {
        ...comum,
        situacao: "outro_motivo",
        orientacao: montarOrientacao(ptw, boostsFaltantes),
        motivo: `Não está ganhando e não é por preço${rotulos.length ? `: ${rotulos.join("; ")}` : ""}.`,
      },
      itemsCacheRow,
    };
  }

  const precoParaGanhar = ptw.price_to_win!;
  const precoSugerido = arredondarPrecoPsicologico(precoParaGanhar) ?? precoParaGanhar;
  const situacaoTxt =
    `Perdendo por preço: o ML indica ${brl(precoParaGanhar)} pra ganhar (hoje ${brl(ptw.current_price!)}` +
    `${ptw.winner?.price != null ? `, vencedor a ${brl(ptw.winner.price)}` : ""}).`;

  const [commission, freeShipping, promotions] = await Promise.all([
    ctx.client.getCommission(detail),
    ctx.client.getFreeShippingCost(ctx.userId, detail),
    ctx.client.getItemPromotions(mlb),
  ]);
  if (!commission.ok || commission.percentage_fee == null) {
    return {
      row: {
        ...comum,
        situacao: "preco",
        preco_sugerido: precoSugerido,
        status: "erro",
        motivo: `${situacaoTxt} Não foi possível calcular a margem: falha ao obter a comissão (${commission.error ?? "sem detalhe"}).`,
      },
      itemsCacheRow,
    };
  }
  const comissaoPct = commission.percentage_fee / 100;
  const freteNoPreco = criarFretePorPreco(ctx, detail, freeShipping.ok ? freeShipping.list_cost ?? 0 : 0);
  const margemDe = async (row: ItemConfigRow, preco: number, tarifaValor: number) =>
    calcMargemResultante({
      preco, cmv: row.cmv, freteMedio: await freteNoPreco(preco), comissaoPct, taxasPct: ctx.taxasPct, descontoTarifaValor: tarifaValor,
    });

  // Cada R$ de redução de tarifa vira R$ de lucro 1:1 (calcMargemResultante),
  // então o que falta pra margem mínima é (mínima − margem) × preço. Com
  // várias variações, vale a que precisa de mais incentivo.
  let ref: { row: ItemConfigRow; margem: number; incentivo: number } | null = null;
  for (const row of rows) {
    const margem = await margemDe(row, precoSugerido, 0);
    const incentivo = Math.max(0, (row.margem_minima_pct / 100 - margem) * precoSugerido);
    if (!ref || incentivo > ref.incentivo || (incentivo === ref.incentivo && margem < ref.margem)) {
      ref = { row, margem, incentivo };
    }
  }
  const analise = {
    ...comum,
    situacao: "preco" as const,
    preco_sugerido: precoSugerido,
    margem_sem_incentivo_pct: ref!.margem * 100,
    margem_minima_pct: ref!.row.margem_minima_pct,
    incentivo_necessario_valor: ref!.incentivo,
    incentivo_necessario_pct: (ref!.incentivo / precoSugerido) * 100,
    sku_referencia: ref!.row.sku || null,
    // price_to_win abaixo do preço do VENCEDOR = o ML está compensando
    // benefícios que ele tem e este item não (visto: R$ 1,57 pra ganhar de
    // um vencedor a R$ 20,21 com frete grátis + envio no mesmo dia).
    orientacao: boostsFaltantes.length === 0
      ? null
      : ptw.winner?.price != null && precoParaGanhar < ptw.winner.price
        ? `O preço pra ganhar fica abaixo do preço do vencedor porque ele tem ${boostsFaltantes.map(rotuloBoost).join(", ")} e você não — ` +
          `${boostsFaltantes.map((b) => BOOST_CATALOGO[b]?.acao ?? b).join("; ")} pode sair mais barato que baixar o preço.`
        : `Além do preço, o vencedor tem ${boostsFaltantes.map(rotuloBoost).join(", ")} e você não.`,
  };
  const semIncentivoTxt =
    `Sem incentivo do ML, a ${brl(precoSugerido)} a margem seria ${(ref!.margem * 100).toFixed(1)}%` +
    (ref!.incentivo > 0
      ? ` — faltariam ${brl(ref!.incentivo)} de incentivo pra atingir a mínima de ${ref!.row.margem_minima_pct}%.`
      : ` (já atende a mínima de ${ref!.row.margem_minima_pct}%).`);

  // current_price só reflete campanha já iniciada — uma aceita e ainda
  // "pending" com preço que vence vai resolver sozinha quando começar, e
  // aderir a outra agora seria uma gravação à toa.
  const programadaQueVence = promotions.find((p) => {
    const preco = p.total_price_for_boosted_offer ?? p.price ?? 0;
    return (p.status ?? "").toLowerCase() === "pending" && preco > 0 && preco <= precoParaGanhar + 0.005;
  });
  if (programadaQueVence) {
    const preco = programadaQueVence.total_price_for_boosted_offer ?? programadaQueVence.price!;
    return {
      row: {
        ...analise,
        motivo:
          `${situacaoTxt} Já existe ${programadaQueVence.promotion_type} programada a ${brl(preco)} — ` +
          `deve fazer o item ganhar quando começar, nenhuma adesão nova necessária. ${semIncentivoTxt}`,
      },
      itemsCacheRow,
    };
  }

  const candidatas: CampanhaCandidata[] = [];
  let melhorAbaixoDoMinimo: { tipo: string; margem: number } | null = null;
  for (const promo of promotions) {
    const cfg = getCampaignTypeConfig(promo.promotion_type);
    if (!cfg.writeSupported || cfg.priceMode === "no_price" || TIPOS_SEM_EFEITO_NO_BUYBOX.has(promo.promotion_type)) continue;
    const ativa = ACTIVE_STATUSES.has((promo.status ?? "").toLowerCase());

    let preco: number;
    if (cfg.priceMode === "fixed_by_ml") {
      // Já ativa/programada com preço fixo: não há o que mudar nela.
      if (ativa) continue;
      preco = promo.total_price_for_boosted_offer ?? promo.price ?? 0;
      if (!preco || preco > precoParaGanhar + 0.005) continue;
    } else {
      // Vendedor define o preço. Ativa = atualizar o preço dela (sai e
      // reentra), só onde o tipo permite sair depois de ativa.
      if (ativa && !cfg.canDeleteAfterActive) continue;
      preco = precoSugerido;
      if (promo.max_discounted_price != null && preco > promo.max_discounted_price) preco = promo.max_discounted_price;
      // Mesmos pisos que o motor de campanhas respeita: faixa da API,
      // limite de 80% de desconto (MAXIMUM_DISCOUNT_PERCENT) e o piso de
      // credibilidade do LIGHTNING. Se algum ficar acima do preço que
      // vence, a campanha não consegue chegar lá.
      const pisos = [
        promo.min_discounted_price ?? null,
        promo.original_price != null ? promo.original_price * 0.21 : null,
        promo.promotion_type === "LIGHTNING" ? promo.suggested_discounted_price ?? null : null,
      ];
      if (pisos.some((p) => p != null && p > preco + 0.005)) continue;
    }

    const { stock, erro: erroEstoque } = calcStockSugerido(promo, detail.available_quantity ?? null);
    if (erroEstoque) continue;

    const tarifa = estimarReducaoTarifa(promo);
    let pior = Infinity;
    let atingeMinimo = true;
    for (const row of rows) {
      const m = await margemDe(row, preco, tarifa?.valor ?? 0);
      if (m < pior) pior = m;
      if (m < row.margem_minima_pct / 100) atingeMinimo = false;
    }
    if (!atingeMinimo) {
      if (!melhorAbaixoDoMinimo || pior > melhorAbaixoDoMinimo.margem) {
        melhorAbaixoDoMinimo = { tipo: promo.promotion_type, margem: pior };
      }
      continue;
    }
    candidatas.push({ promo, preco, margem: pior, tarifa, stock, mesmaCampanhaAtiva: ativa });
  }

  // Mesma prioridade do motor de campanhas: pré-acordada com o ML >
  // criada pelo ML > criada pelo vendedor; dentro do grupo, maior margem
  // (todas já vencem o buybox, então o critério é ganhar ganhando mais).
  const grupo = (c: CampanhaCandidata) =>
    c.promo.promotion_type === "PRE_NEGOTIATED" ? 0 : getCampaignTypeConfig(c.promo.promotion_type).origem === "mercado_livre" ? 1 : 2;
  candidatas.sort((a, b) => grupo(a) - grupo(b) || b.margem - a.margem);
  const escolhida = candidatas[0] ?? null;

  if (!escolhida) {
    const abaixoTxt = melhorAbaixoDoMinimo
      ? ` (${melhorAbaixoDoMinimo.tipo} chegaria, mas com margem ${(melhorAbaixoDoMinimo.margem * 100).toFixed(1)}%)`
      : "";
    return {
      row: {
        ...analise,
        motivo: `${situacaoTxt} Nenhuma campanha disponível chega a esse preço mantendo a margem mínima${abaixoTxt}. ${semIncentivoTxt}`,
      },
      itemsCacheRow,
    };
  }

  const acao = escolhida.mesmaCampanhaAtiva
    ? `atualizar o preço da ${escolhida.promo.promotion_type} já ativa (sai e reentra)`
    : `aderir à ${escolhida.promo.promotion_type}`;
  const tarifaTxt = escolhida.tarifa ? `, com incentivo do ML de ${brl(escolhida.tarifa.valor)}` : "";
  return {
    row: {
      ...analise,
      promotion_id: escolhida.promo.promotion_id,
      promotion_type: escolhida.promo.promotion_type,
      offer_id: escolhida.promo.offer_id ?? null,
      preco_proposto: escolhida.preco,
      margem_campanha_pct: escolhida.margem * 100,
      reducao_tarifa_valor: escolhida.tarifa?.valor ?? null,
      reducao_tarifa_fonte: escolhida.tarifa?.fonte ?? null,
      stock_sugerido: escolhida.stock,
      troca: escolhida.mesmaCampanhaAtiva,
      campanha_anterior_id: escolhida.mesmaCampanhaAtiva ? escolhida.promo.promotion_id : null,
      campanha_anterior_tipo: escolhida.mesmaCampanhaAtiva ? escolhida.promo.promotion_type : null,
      campanha_anterior_offer_id: escolhida.mesmaCampanhaAtiva ? escolhida.promo.offer_id ?? null : null,
      gravavel: true,
      status: "pendente",
      motivo:
        `${situacaoTxt} Sugestão: ${acao} a ${brl(escolhida.preco)} — margem ${(escolhida.margem * 100).toFixed(1)}%${tarifaTxt}. ` +
        semIncentivoTxt,
    },
    itemsCacheRow,
  };
}

export async function* runCatalogUpdate(resumeRunId?: string): AsyncGenerator<ProgressEvent> {
  const startedAt = Date.now();
  const supabase = createServiceSupabase();

  const carregado = await carregarUniverso(supabase);
  if (carregado.erro !== null) {
    yield { type: "error", message: carregado.erro };
    return;
  }
  const { taxasPct, byMlb } = carregado.universo;

  // Pausado não disputa o buybox — e no universo real (2026-11-17) só 363
  // dos 1.281 anúncios de catálogo estavam ativos, então filtrar antes
  // corta a maior parte das chamadas à API.
  const ativos = await mlbsAtivosNoCache(supabase, [...byMlb.keys()]);
  const universoAtivo = [...byMlb.keys()].filter((m) => ativos.has(m));
  if (universoAtivo.length === 0) {
    yield {
      type: "error",
      message: "Nenhum anúncio ativo no cache — rode \"Atualizar agora\" no Painel (todos os itens) pelo menos uma vez antes.",
    };
    return;
  }

  const runId = resumeRunId ?? randomUUID();
  const jaProcessados = new Set<string>();
  if (resumeRunId) {
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase
        .from("catalog_decisions")
        .select("mlb")
        .eq("run_id", resumeRunId)
        .range(from, from + 999);
      if (!page || page.length === 0) break;
      for (const d of page) jaProcessados.add(d.mlb);
      if (page.length < 1000) break;
    }
    yield { type: "log", message: `Retomando rodada ${resumeRunId} — ${jaProcessados.size}/${universoAtivo.length} já processados.` };
  } else {
    yield { type: "log", message: `${universoAtivo.length} anúncios ativos no universo — verificando quais são de catálogo...` };
  }
  const mlbs = universoAtivo.filter((m) => !jaProcessados.has(m));

  const client = await MercadoLivreClient.fromStore();
  const userId = await client.getUserId();
  const ctx: CatalogContext = { client, userId, taxasPct, runId };
  if (!resumeRunId) yield { type: "log", message: await atualizarGmvNaRodada(supabase, client, userId) };
  let doneCount = jaProcessados.size;

  for (let i = 0; i < mlbs.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      yield { type: "partial", runId, done: doneCount, total: universoAtivo.length };
      return;
    }
    const batch = mlbs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((mlb) => processCatalogMlb(mlb, byMlb.get(mlb)!, ctx)));

    const cacheRows = results.map((r) => r.itemsCacheRow).filter((r): r is Record<string, unknown> => r !== null);
    if (cacheRows.length > 0) {
      const { error } = await supabase.from("items_cache").upsert(cacheRows);
      if (error) yield { type: "log", message: `[aviso] falha ao gravar items_cache em lote: ${error.message}` };
    }
    const { error } = await supabase.from("catalog_decisions").insert(results.map((r) => r.row));
    if (error) {
      yield { type: "error", message: `Falha ao gravar análise do lote (MLBs ${batch.join(", ")}): ${error.message}` };
      return;
    }
    doneCount += batch.length;
    yield { type: "progress", done: doneCount, total: universoAtivo.length };
  }

  const { count: analisados } = await supabase
    .from("catalog_decisions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .neq("situacao", "nao_catalogo");
  const { count: perdendo } = await supabase
    .from("catalog_decisions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("situacao", ["preco", "outro_motivo"]);
  yield { type: "done", runId, totalDecisions: analisados ?? 0, totalEscolhidas: perdendo ?? 0 };
}
