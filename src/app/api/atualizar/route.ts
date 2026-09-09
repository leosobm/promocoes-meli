import { runUpdate } from "@/lib/decisionEngine";

export const maxDuration = 300; // segundos — limite da function; ver AVISO no README se o catálogo crescer

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
