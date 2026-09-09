// Roda uma atualização REAL e COMPLETA do catálogo, encadeando runUpdate()
// exatamente como o UpdateButton faz no navegador (chamada -> "partial" ->
// retoma com o mesmo runId -> repete até "done"). Grava de verdade em
// campaign_decisions (é a mesma lógica de produção) — não é um teste
// descartável como debug-one-mlb.ts.
import fs from "fs";
import path from "path";

const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

async function main() {
  const { runUpdate } = await import("../lib/decisionEngine");

  let runId: string | undefined;
  let hop = 0;
  const startedAt = Date.now();

  for (; hop < 50; hop++) {
    console.log(`\n=== Chamada ${hop + 1} (runId=${runId ?? "novo"}) ===`);
    let done: { totalDecisions: number; totalEscolhidas: number } | null = null;
    let partial: { runId: string; done: number; total: number } | null = null;

    for await (const evt of runUpdate(runId)) {
      if (evt.type === "log") console.log("  [log]", evt.message);
      if (evt.type === "progress") process.stdout.write(`\r  progresso: ${evt.done}/${evt.total}   `);
      if (evt.type === "error") {
        console.error("\n  [ERRO]", evt.message);
        process.exit(1);
      }
      if (evt.type === "partial") {
        partial = evt;
      }
      if (evt.type === "done") {
        done = evt;
      }
    }
    console.log();

    if (done) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`\n>> CONCLUÍDO em ${elapsed}s (${hop + 1} chamada(s)).`);
      console.log(`>> ${done.totalDecisions} decisões, ${done.totalEscolhidas} escolhidas.`);
      return;
    }
    if (partial) {
      runId = partial.runId;
      continue;
    }
    console.error("Stream terminou sem done nem partial — algo inesperado.");
    process.exit(1);
  }
  console.error("Não terminou após 50 chamadas.");
  process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("ERRO:", err);
    process.exit(1);
  },
);
