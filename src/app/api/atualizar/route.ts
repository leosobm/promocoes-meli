import { NextRequest } from "next/server";
import { runUpdate } from "@/lib/decisionEngine";

// 60s = teto do plano Hobby da Vercel. O motor de decisão já respeita um
// orçamento de tempo interno menor (ver TIME_BUDGET_MS em decisionEngine.ts)
// e devolve um evento "partial" pra continuar em outra chamada — catálogos
// grandes (visto na prática: quase 3 mil MLBs) são cobertos em várias
// invocações encadeadas pelo próprio UpdateButton, não numa função só.
export const maxDuration = 60;

/** Rota protegida pelo middleware. Dispara a leitura de campanhas + cálculo
 * de decisões, transmitindo o progresso via Server-Sent Events. NUNCA grava
 * nada no Mercado Livre — só calcula e salva em campaign_decisions. Aceita
 * {runId} no corpo pra retomar uma rodada que parou no meio (orçamento de
 * tempo estourado) em vez de recomeçar do zero. */
export async function POST(request: NextRequest) {
  let resumeRunId: string | undefined;
  try {
    const body = await request.json();
    resumeRunId = body?.runId || undefined;
  } catch {
    // corpo vazio = primeira chamada de uma rodada nova, sem runId ainda
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const event of runUpdate(resumeRunId)) {
          send(event);
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
