import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { getCampaignTypeConfig } from "@/lib/mercadolivre/campaignTypes";

interface ApplyBody {
  decisionIds: string[];
  confirmacao: string;
}

/**
 * Rota protegida pelo middleware — GRAVA de verdade no Mercado Livre.
 * Exige confirmacao === "CONFIRMAR" no corpo (mesmo padrão de
 * mercadolivre_adesao_campanhas.py) além da sessão autenticada. Só aplica
 * decisões com gravavel=true e status='pendente' — nunca reprocessa uma já
 * aplicada/rejeitada, e nunca ignora o piso de margem (isso já foi
 * garantido na hora de gerar a decisão, em decisionEngine.ts).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as ApplyBody;
  if (body.confirmacao !== "CONFIRMAR") {
    return NextResponse.json(
      { error: "Confirmação ausente ou incorreta. Envie confirmacao: 'CONFIRMAR'." },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.decisionIds) || body.decisionIds.length === 0) {
    return NextResponse.json({ error: "decisionIds vazio." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const { data: decisions, error } = await supabase
    .from("campaign_decisions")
    .select("*")
    .in("id", body.decisionIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const client = await MercadoLivreClient.fromStore();
  const results: { id: string; mlb: string; ok: boolean; detalhe: string }[] = [];

  for (const d of decisions ?? []) {
    if (!d.gravavel || d.status !== "pendente") {
      results.push({
        id: d.id,
        mlb: d.mlb,
        ok: false,
        detalhe: `Pulada: gravavel=${d.gravavel}, status=${d.status} (só aplica decisões pendentes e graváveis).`,
      });
      continue;
    }
    // Troca: sai da campanha anterior ANTES de entrar na nova — não tenta
    // aderir com a antiga ainda ativa (payload errado poderia fixar preço
    // promocional incorreto num item que já está com outro preço vigente).
    if (d.troca && d.campanha_anterior_id) {
      const leave = await client.leaveItem(d.mlb, d.campanha_anterior_id, d.campanha_anterior_tipo, {
        offerId: d.campanha_anterior_offer_id ?? undefined,
        currentStatus: "active",
      });
      if (!leave.ok) {
        await supabase
          .from("campaign_decisions")
          .update({
            status: "erro",
            applied_at: new Date().toISOString(),
            motivo: `${d.motivo} | ERRO ao sair da campanha anterior (${d.campanha_anterior_tipo}): ${JSON.stringify(leave.response)}`,
            resposta_api: leave.response,
          })
          .eq("id", d.id);
        results.push({
          id: d.id, mlb: d.mlb, ok: false,
          detalhe: `Falha ao sair de ${d.campanha_anterior_tipo} — troca cancelada, novo join não foi tentado.`,
        });
        continue;
      }
    }

    const typeCfg = getCampaignTypeConfig(d.promotion_type);
    const r = await client.joinItem(d.mlb, d.promotion_id, d.promotion_type, {
      dealPrice: typeCfg.priceMode === "seller_defined" ? d.preco_proposto ?? undefined : undefined,
      offerId: d.offer_id ?? undefined,
    });

    // 2xx não é garantia de que o preço pedido realmente "colou" — visto
    // na prática: reenviar join pra uma campanha já iniciada pode
    // responder sucesso sem mudar o preço vigente. Quando a resposta
    // ecoa um preço, compara com o que foi pedido e avisa se divergir.
    const respostaPreco = (r.response as Record<string, unknown> | null)?.price;
    const precoDivergente =
      r.ok && typeof respostaPreco === "number" && d.preco_proposto != null &&
      Math.abs(respostaPreco - d.preco_proposto) > 0.01;

    const status = r.ok ? "aplicada" : "erro";
    let motivoFinal = r.ok ? d.motivo : `${d.motivo} | ERRO na gravação: ${JSON.stringify(r.response)}`;
    if (precoDivergente) {
      motivoFinal += ` | ATENÇÃO: pedimos R$ ${d.preco_proposto.toFixed(2)}, API confirmou R$ ${Number(respostaPreco).toFixed(2)} — a campanha pode já estar ativa com outro preço e não ter sido atualizada. Confira no painel do ML.`;
    }

    await supabase
      .from("campaign_decisions")
      .update({
        status,
        applied_at: new Date().toISOString(),
        motivo: motivoFinal,
        resposta_api: r.response,
      })
      .eq("id", d.id);

    results.push({
      id: d.id, mlb: d.mlb, ok: r.ok && !precoDivergente,
      detalhe: precoDivergente
        ? `Aplicado mas com preço divergente (pedido R$ ${d.preco_proposto.toFixed(2)}, API confirmou R$ ${Number(respostaPreco).toFixed(2)}) — confira no ML.`
        : JSON.stringify(r.response).slice(0, 300),
    });
  }

  return NextResponse.json({ results });
}
