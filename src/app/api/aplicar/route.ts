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
    const typeCfg = getCampaignTypeConfig(d.promotion_type);
    const r = await client.joinItem(d.mlb, d.promotion_id, d.promotion_type, {
      dealPrice: typeCfg.priceMode === "seller_defined" ? d.preco_proposto ?? undefined : undefined,
      offerId: d.offer_id ?? undefined,
    });

    const status = r.ok ? "aplicada" : "erro";
    await supabase
      .from("campaign_decisions")
      .update({
        status,
        applied_at: new Date().toISOString(),
        motivo: r.ok ? d.motivo : `${d.motivo} | ERRO na gravação: ${JSON.stringify(r.response)}`,
      })
      .eq("id", d.id);

    results.push({ id: d.id, mlb: d.mlb, ok: r.ok, detalhe: JSON.stringify(r.response).slice(0, 300) });
  }

  return NextResponse.json({ results });
}
