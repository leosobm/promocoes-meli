// Script de diagnóstico único — roda processMlb() de verdade (mesma lógica
// da produção) pra UM MLB, sem gravar nada no banco. Não faz parte do app,
// é só pra este teste manual.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

async function main() {
  const { processMlb } = await import("../lib/decisionEngine");
  const { MercadoLivreClient } = await import("../lib/mercadolivre/client");
  const { createServiceSupabase } = await import("../lib/supabase/server");

  const mlb = process.argv[2] || "MLB3845175083";
  const supabase = createServiceSupabase();

  const { data: settingsRowRaw } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct, margem_tolerancia_pct, margem_minima_pct, margem_alvo_pct")
    .eq("id", 1)
    .single();
  if (!settingsRowRaw) {
    console.error("app_settings não encontrado.");
    process.exit(1);
  }
  const settingsRow = settingsRowRaw;
  const { data: rawRows } = await supabase
    .from("item_config")
    .select("mlb, sku, cmv, margem_minima_pct, margem_alvo_pct")
    .eq("mlb", mlb);

  if (!rawRows || rawRows.length === 0) {
    console.error(`Nenhuma linha em item_config para ${mlb}`);
    process.exit(1);
  }

  // Mesma resolução de fallback que runUpdate() aplica: item sem margem
  // própria usa a geral do sistema (ver 20260924000000_margem_geral.sql).
  const rows = rawRows.map((r) => {
    const margemMinimaEfetiva = r.margem_minima_pct ?? settingsRow.margem_minima_pct;
    return {
      ...r,
      margem_minima_pct: margemMinimaEfetiva,
      margem_alvo_pct: r.margem_alvo_pct ?? settingsRow.margem_alvo_pct ?? null,
    };
  });

  console.log(`>> item_config para ${mlb} (já com fallback de margem geral aplicado):`, JSON.stringify(rows, null, 2));

  const client = await MercadoLivreClient.fromStore();
  const userId = await client.getUserId();
  console.log(`>> Autenticado, user_id ${userId}`);

  const ctx = {
    client,
    userId,
    taxasPct: settingsRow.taxas_pct / 100,
    toleranciaFrac: settingsRow.margem_tolerancia_pct / 100,
    weights: {
      pesoDesconto: settingsRow.peso_desconto_pct / 100,
      pesoMl: settingsRow.peso_ml_pct / 100,
      pesoMargem: settingsRow.peso_margem_pct / 100,
    },
    runId: randomUUID(),
  };

  const result = await processMlb(mlb, rows as never, ctx as never);
  console.log(`>> ${result.decisionRows.length} decisões calculadas, ${result.escolhidas} escolhida(s).`);

  const { error: insertError } = await supabase.from("campaign_decisions").insert(result.decisionRows);
  if (insertError) {
    console.error(">> INSERT FALHOU:", insertError.message);
    process.exit(1);
  }
  console.log(">> INSERT OK.");

  const { data: back } = await supabase
    .from("campaign_decisions")
    .select("id, mlb, promotion_type, escolhida, gravavel, status, margem_calculada_pct, score, troca, dentro_tolerancia, recomendacao, campanha_anterior_tipo, motivo")
    .eq("run_id", ctx.runId);
  console.log(">> Lido de volta do banco:", JSON.stringify(back, null, 2));

  const { error: delError } = await supabase.from("campaign_decisions").delete().eq("run_id", ctx.runId);
  console.log(delError ? `>> FALHA AO LIMPAR: ${delError.message}` : ">> Limpeza OK (linhas de teste removidas).");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("ERRO:", err);
    process.exit(1);
  },
);
