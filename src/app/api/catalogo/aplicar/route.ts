import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { aplicarDecisao } from "@/lib/aplicarDecisao";

export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;
const FETCH_CHUNK = 150; // .in() vai na URL — ver /api/aplicar

interface ApplyBody {
  decisionIds: string[];
  confirmacao: string;
}

/** GRAVA de verdade no Mercado Livre — mesmas travas de /api/aplicar
 * (confirmacao === "CONFIRMAR", só linhas gravavel + pendente) e o mesmo
 * caminho de gravação (aplicarDecisao), retomável por remainingIds. */
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
  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < body.decisionIds.length; i += FETCH_CHUNK) {
    const chunk = body.decisionIds.slice(i, i + FETCH_CHUNK);
    const { data, error } = await supabase.from("catalog_decisions").select("*").in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const d of data ?? []) byId.set(d.id as string, d);
  }

  const client = await MercadoLivreClient.fromStore();
  const results: { id: string; mlb: string; ok: boolean; detalhe: string }[] = [];
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
      results.push({ id, mlb: "?", ok: false, detalhe: "Recomendação não encontrada (id inválido?)." });
      continue;
    }
    if (!d.gravavel || d.status !== "pendente" || !d.promotion_id) {
      results.push({
        id: d.id, mlb: d.mlb, ok: false,
        detalhe: `Pulada: gravavel=${d.gravavel}, status=${d.status} (só aplica recomendações pendentes com campanha sugerida).`,
      });
      continue;
    }

    // Catálogo sempre BAIXA o preço pra vencer — com campanha diferente da
    // ativa, a mais barata prevalece sozinha e a anterior fica de backup;
    // com a mesma campanha (troca=true), sai e reentra com o preço novo.
    const res = await aplicarDecisao(client, { ...d, recomendacao: "diminuir_preco" });
    await supabase.from("catalog_decisions").update(res.atualizacao).eq("id", d.id);
    results.push({ id: d.id, mlb: d.mlb, ok: res.ok, detalhe: res.detalhe });
  }

  const remainingIds = body.decisionIds.slice(cutoffIndex);
  return NextResponse.json({ results, done: remainingIds.length === 0, remainingIds });
}
