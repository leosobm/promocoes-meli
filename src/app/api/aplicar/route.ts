import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { aplicarDecisao } from "@/lib/aplicarDecisao";

// 60s = teto do plano Hobby da Vercel. Lotes grandes (visto na prática:
// 1116 itens selecionados de uma vez) não cabem numa chamada só — cada
// item pode exigir 2 chamadas de escrita na API do ML (sair + entrar numa
// troca) mais a gravação no banco. Processa dentro de um orçamento de
// tempo e devolve o que sobrou pra quem chamou continuar.
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;

// PostgREST manda o filtro .in() na própria URL da requisição — com
// centenas/milhares de UUIDs isso estoura o limite de tamanho de URL do
// servidor e retorna 400 Bad Request antes de processar qualquer coisa.
// Busca em blocos pequenos e concatena.
const FETCH_CHUNK = 150;

interface ApplyBody {
  decisionIds: string[];
  confirmacao: string;
}

interface ApplyResult {
  id: string;
  mlb: string;
  ok: boolean;
  detalhe: string;
}

/**
 * Rota protegida pelo middleware — GRAVA de verdade no Mercado Livre.
 * Exige confirmacao === "CONFIRMAR" no corpo (mesmo padrão de
 * mercadolivre_adesao_campanhas.py) além da sessão autenticada. Só aplica
 * decisões com gravavel=true e status='pendente'/'tolerancia' — nunca
 * reprocessa uma já aplicada/rejeitada, e nunca ignora o piso de margem
 * (isso já foi garantido na hora de gerar a decisão, em decisionEngine.ts).
 *
 * Lotes grandes: processa até esgotar TIME_BUDGET_MS e devolve
 * {done:false, results, remainingIds} — quem chama reenvia só os
 * remainingIds pra continuar (mesmo padrão retomável do /api/atualizar).
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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

  // Busca as decisões em blocos pequenos (ver FETCH_CHUNK acima) — mantém
  // a ORDEM de body.decisionIds pra saber exatamente onde parar/retomar.
  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < body.decisionIds.length; i += FETCH_CHUNK) {
    const chunk = body.decisionIds.slice(i, i + FETCH_CHUNK);
    const { data, error } = await supabase.from("campaign_decisions").select("*").in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const d of data ?? []) byId.set(d.id as string, d);
  }

  const client = await MercadoLivreClient.fromStore();
  const results: ApplyResult[] = [];
  let cutoffIndex = body.decisionIds.length;

  for (let i = 0; i < body.decisionIds.length; i++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      cutoffIndex = i;
      break;
    }

    const id = body.decisionIds[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = byId.get(id) as any;
    if (!d) {
      results.push({ id, mlb: "?", ok: false, detalhe: "Decisão não encontrada (id inválido?)." });
      continue;
    }

    if (!d.gravavel || (d.status !== "pendente" && d.status !== "tolerancia")) {
      results.push({
        id: d.id,
        mlb: d.mlb,
        ok: false,
        detalhe: `Pulada: gravavel=${d.gravavel}, status=${d.status} (só aplica decisões pendentes/tolerância e graváveis).`,
      });
      continue;
    }

    const res = await aplicarDecisao(client, d);
    await supabase.from("campaign_decisions").update(res.atualizacao).eq("id", d.id);
    results.push({ id: d.id, mlb: d.mlb, ok: res.ok, detalhe: res.detalhe });
  }

  const remainingIds = body.decisionIds.slice(cutoffIndex);
  return NextResponse.json({ results, done: remainingIds.length === 0, remainingIds });
}
