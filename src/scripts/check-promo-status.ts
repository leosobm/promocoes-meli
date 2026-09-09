// Diagnóstico ad-hoc: mostra o estado AO VIVO (direto da API do ML) das
// promoções de um item, sem gravar nada — pra investigar discrepância
// entre o que o app registrou e o que está de fato no Mercado Livre.
import fs from "fs";
import path from "path";

const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

async function main() {
  const { MercadoLivreClient } = await import("../lib/mercadolivre/client");
  const mlb = process.argv[2];
  if (!mlb) throw new Error("uso: tsx check-promo-status.ts <MLB>");

  const client = await MercadoLivreClient.fromStore();
  const promotions = await client.getItemPromotions(mlb);
  console.log(`>> ${promotions.length} promoções encontradas ao vivo pra ${mlb}:`);
  console.log(JSON.stringify(promotions, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("ERRO:", err);
    process.exit(1);
  },
);
