import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";

// 60s = teto do plano Hobby da Vercel. Roda TODO DIA (Cron Job Hobby não
// permite mais que 1x/dia) apagando o que passou de 15 dias — mantém uma
// janela corrente de retenção em vez de deixar a tabela crescer até um
// "big bang" a cada 15 dias (que deixaria a tabela enorme boa parte do
// tempo entre limpezas). Ver vercel.json pro agendamento.
export const maxDuration = 60;

const RETENCAO_DIAS = 15;

/** Protegido por CRON_SECRET (header Authorization: Bearer <secret>, é
 * como a Vercel chama cron jobs automaticamente quando a env var existe) —
 * sem isso, qualquer um que descobrisse a URL poderia apagar o histórico
 * de decisões. Só apaga campaign_decisions (histórico calculado/aplicado);
 * nunca mexe em item_config, items_cache ou ml_tokens. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();
  const cutoff = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await supabase
    .from("campaign_decisions")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedCount: count ?? 0, retencaoDias: RETENCAO_DIAS, cutoff });
}
