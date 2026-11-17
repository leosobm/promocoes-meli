import { NextRequest } from "next/server";
import { runCatalogUpdate } from "@/lib/catalogEngine";

// Mesmo padrão retomável de /api/atualizar: o motor para sozinho dentro do
// orçamento de tempo e devolve "partial"; o botão reconecta com o runId.
export const maxDuration = 60;

/** Rota protegida pelo middleware. Lê a competição de catálogo e calcula
 * recomendações — NUNCA grava nada no Mercado Livre. */
export async function POST(request: NextRequest) {
  let resumeRunId: string | undefined;
  try {
    const body = await request.json();
    resumeRunId = body?.runId || undefined;
  } catch {
    // corpo vazio = rodada nova
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const event of runCatalogUpdate(resumeRunId)) {
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
