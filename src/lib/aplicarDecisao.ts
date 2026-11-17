import type { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { getCampaignTypeConfig } from "@/lib/mercadolivre/campaignTypes";

/** Campos que a gravação precisa — comuns a campaign_decisions e
 * catalog_decisions, pra que os dois painéis gravem pelo MESMO caminho. */
export interface DecisaoAplicavel {
  mlb: string;
  promotion_id: string;
  promotion_type: string;
  offer_id: string | null;
  preco_proposto: number | null;
  stock_sugerido: number | null;
  ml_participacao_pct?: number | null;
  seller_percentage?: number | null;
  troca: boolean;
  campanha_anterior_id: string | null;
  campanha_anterior_tipo: string | null;
  campanha_anterior_offer_id: string | null;
  recomendacao: string | null;
  motivo: string;
}

export interface ResultadoAplicacao {
  ok: boolean;
  detalhe: string;
  atualizacao: { status: "aplicada" | "erro"; applied_at: string; motivo: string; resposta_api: unknown };
}

export async function aplicarDecisao(client: MercadoLivreClient, d: DecisaoAplicavel): Promise<ResultadoAplicacao> {
  // Troca com DIMINUIÇÃO de preço, entre campanhas DIFERENTES: não sai da
  // anterior — a nova (mais barata) já prevalece sozinha (o ML mostra o
  // menor preço entre as ofertas ativas do item), e a anterior fica como
  // "backup" pra retomar automaticamente quando a nova expirar (pensado
  // pra LIGHTNING, de curta duração). Isso NÃO se aplica a atualização de
  // preço dentro da MESMA campanha (campanha_anterior_id === promotion_id
  // — aí sair e reentrar é o único jeito de mudar o preço, não uma
  // escolha de negócio) nem a trocas com AUMENTO de preço, onde só sair
  // da anterior (mais barata) faz a nova realmente entrar em vigor.
  const ehTrocaEntreCampanhasDiferentes = d.troca && d.campanha_anterior_id && d.campanha_anterior_id !== d.promotion_id;
  const mantemAnteriorComoBackup = ehTrocaEntreCampanhasDiferentes && d.recomendacao === "diminuir_preco";

  if (d.troca && d.campanha_anterior_id && !mantemAnteriorComoBackup) {
    const leave = await client.leaveItem(d.mlb, d.campanha_anterior_id, d.campanha_anterior_tipo ?? "", {
      offerId: d.campanha_anterior_offer_id ?? undefined,
      currentStatus: "active",
    });
    if (!leave.ok) {
      return {
        ok: false,
        detalhe: `Falha ao sair de ${d.campanha_anterior_tipo} — troca cancelada, novo join não foi tentado.`,
        atualizacao: {
          status: "erro",
          applied_at: new Date().toISOString(),
          motivo: `${d.motivo} | ERRO ao sair da campanha anterior (${d.campanha_anterior_tipo}): ${JSON.stringify(leave.response)}`,
          resposta_api: leave.response,
        },
      };
    }
  }

  const typeCfg = getCampaignTypeConfig(d.promotion_type);
  const r = await client.joinItem(d.mlb, d.promotion_id, d.promotion_type, {
    dealPrice: typeCfg.priceMode === "seller_defined" ? d.preco_proposto ?? undefined : undefined,
    offerId: d.offer_id ?? undefined,
    stock: typeCfg.extraJoinFields === "stock" ? d.stock_sugerido ?? undefined : undefined,
    meliPercentage: typeCfg.extraJoinFields === "percentages" ? d.ml_participacao_pct ?? undefined : undefined,
    sellerPercentage: typeCfg.extraJoinFields === "percentages" ? d.seller_percentage ?? undefined : undefined,
  });

  // 2xx não é garantia de que o preço pedido realmente "colou" — visto
  // na prática: reenviar join pra uma campanha já iniciada pode
  // responder sucesso sem mudar o preço vigente. Quando a resposta
  // ecoa um preço, compara com o que foi pedido e avisa se divergir.
  const respostaPreco = (r.response as Record<string, unknown> | null)?.price;
  const precoDivergente =
    r.ok && typeof respostaPreco === "number" && d.preco_proposto != null &&
    Math.abs(respostaPreco - d.preco_proposto) > 0.01;

  let motivoFinal = r.ok ? d.motivo : `${d.motivo} | ERRO na gravação: ${JSON.stringify(r.response)}`;
  if (precoDivergente) {
    motivoFinal += ` | ATENÇÃO: pedimos R$ ${d.preco_proposto!.toFixed(2)}, API confirmou R$ ${Number(respostaPreco).toFixed(2)} — a campanha pode já estar ativa com outro preço e não ter sido atualizada. Confira no painel do ML.`;
  }
  const backupNota = mantemAnteriorComoBackup && r.ok
    ? ` | ${d.campanha_anterior_tipo} mantida ativa como backup — retoma sozinha quando ${d.promotion_type} expirar.`
    : "";
  motivoFinal += backupNota;

  return {
    ok: r.ok && !precoDivergente,
    detalhe: (precoDivergente
      ? `Aplicado mas com preço divergente (pedido R$ ${d.preco_proposto!.toFixed(2)}, API confirmou R$ ${Number(respostaPreco).toFixed(2)}) — confira no ML.`
      : JSON.stringify(r.response).slice(0, 300)) + backupNota,
    atualizacao: {
      status: r.ok ? "aplicada" : "erro",
      applied_at: new Date().toISOString(),
      motivo: motivoFinal,
      resposta_api: r.response,
    },
  };
}
