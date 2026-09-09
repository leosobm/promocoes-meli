import { runUpdate } from "@/lib/decisionEngine";

// 60s = teto do plano Hobby da Vercel (conta nova, criada agora). Se o
// catálogo crescer e a sincronização passar disso, a function é cortada no
// meio — nesse caso, ou paginamos a atualização em várias chamadas menores,
// ou fazemos upgrade pro plano Pro (maxDuration até 300s). Ver conversa com
// o usuário em 2026-09-09 ("me avise para decidirmos").
export const maxDuration = 60;

/** Rota protegida pelo middleware. Dispara a leitura de campanhas + cálculo
 * de decisões, transmitindo o progresso via Server-Sent Events. NUNCA grava
 * nada no Mercado Livre — só calcula e salva em campaign_decisions. */
export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const event of runUpdate()) {
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
