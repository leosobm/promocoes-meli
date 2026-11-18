import type { SupabaseClient } from "@supabase/supabase-js";
import type { MercadoLivreClient } from "@/lib/mercadolivre/client";
import type { OrderResumo } from "@/lib/mercadolivre/types";

const DIAS = 30;
const POR_PAGINA = 51;
const PARALELO = 8;
// O /orders/search pagina por offset; pra não depender de até onde o ML
// aceita offset alto, janela com mais pedidos que isso é dividida ao meio.
const MAX_POR_JANELA = 5000;
// Pedido cancelado/inválido não é venda — o resto (paid, partially_refunded,
// partially_paid...) entra pelo valor vendido.
const STATUS_FORA = new Set(["cancelled", "invalid"]);

export interface GmvMlb {
  gmv: number;
  unidades: number;
  pedidos: number;
}

export interface ResultadoGmv {
  de: Date;
  ate: Date;
  total: number;
  pedidos: number;
  porMlb: Map<string, GmvMlb>;
}

async function pedidosDaJanela(client: MercadoLivreClient, sellerId: number, de: Date, ate: Date): Promise<OrderResumo[]> {
  const primeira = await client.searchOrders(sellerId, de, ate, 0, POR_PAGINA);
  if (primeira.total > MAX_POR_JANELA && ate.getTime() - de.getTime() > 3600_000) {
    const meio = new Date((de.getTime() + ate.getTime()) / 2);
    const [a, b] = await Promise.all([
      pedidosDaJanela(client, sellerId, de, meio),
      pedidosDaJanela(client, sellerId, new Date(meio.getTime() + 1000), ate),
    ]);
    return [...a, ...b];
  }
  const out = [...primeira.results];
  const offsets: number[] = [];
  for (let o = POR_PAGINA; o < primeira.total; o += POR_PAGINA) offsets.push(o);
  for (let i = 0; i < offsets.length; i += PARALELO) {
    const paginas = await Promise.all(
      offsets.slice(i, i + PARALELO).map((o) => client.searchOrders(sellerId, de, ate, o, POR_PAGINA)),
    );
    for (const p of paginas) out.push(...p.results);
  }
  return out;
}

/** GMV dos últimos 30 dias por MLB: Σ unit_price × quantidade de cada
 * order_item dos pedidos não cancelados (preço pago pelo comprador, sem
 * frete). Pedido com vários itens soma em cada MLB; "pedidos" conta em
 * quantos pedidos o MLB aparece. */
export async function calcularGmv30d(client: MercadoLivreClient, sellerId: number): Promise<ResultadoGmv> {
  const ate = new Date();
  const de = new Date(ate.getTime() - DIAS * 86400_000);
  const pedidos = await pedidosDaJanela(client, sellerId, de, ate);

  const vistos = new Set<number>();
  const porMlb = new Map<string, GmvMlb>();
  let total = 0;
  let validos = 0;
  for (const o of pedidos) {
    if (vistos.has(o.id)) continue;
    vistos.add(o.id);
    if (STATUS_FORA.has(o.status)) continue;
    validos++;
    const noPedido = new Set<string>();
    for (const it of o.order_items ?? []) {
      const valor = (it.unit_price ?? 0) * (it.quantity ?? 0);
      const mlb = it.item?.id;
      if (!mlb) continue;
      const acc = porMlb.get(mlb) ?? { gmv: 0, unidades: 0, pedidos: 0 };
      acc.gmv += valor;
      acc.unidades += it.quantity ?? 0;
      if (!noPedido.has(mlb)) {
        acc.pedidos++;
        noPedido.add(mlb);
      }
      porMlb.set(mlb, acc);
      total += valor;
    }
  }
  return { de, ate, total, pedidos: validos, porMlb };
}

/** Recalcula e grava a foto de GMV (tabela gmv_30d). Grava a foto nova
 * primeiro e só depois apaga as linhas da foto anterior — a tela nunca vê
 * a tabela vazia no meio. */
export async function atualizarSnapshotGmv(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  client: MercadoLivreClient,
  sellerId: number,
): Promise<ResultadoGmv> {
  const r = await calcularGmv30d(client, sellerId);
  const calculadoEm = new Date().toISOString();
  const linhas = [...r.porMlb].map(([mlb, v]) => ({
    mlb,
    gmv: Math.round(v.gmv * 100) / 100,
    unidades: v.unidades,
    pedidos: v.pedidos,
    share_pct: r.total > 0 ? (v.gmv / r.total) * 100 : 0,
    periodo_de: r.de.toISOString(),
    periodo_ate: r.ate.toISOString(),
    calculado_em: calculadoEm,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from("gmv_30d").upsert(linhas.slice(i, i + 500));
    if (error) throw new Error(`Falha ao gravar gmv_30d: ${error.message}`);
  }
  const { error } = await supabase.from("gmv_30d").delete().lt("calculado_em", calculadoEm);
  if (error) throw new Error(`Falha ao limpar gmv_30d antigo: ${error.message}`);
  return r;
}

export interface GmvInfo {
  gmv: number;
  unidades: number;
  share_pct: number;
}

/** Lê a foto de GMV pros MLBs pedidos (blocos de 150 — .in() vai na URL).
 * MLB sem venda no período não tem linha: quem chama trata como 0. */
export async function carregarGmv(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  mlbs: string[],
): Promise<{ porMlb: Map<string, GmvInfo>; calculadoEm: string | null }> {
  const porMlb = new Map<string, GmvInfo>();
  let calculadoEm: string | null = null;
  const unicos = [...new Set(mlbs)];
  for (let i = 0; i < unicos.length; i += 150) {
    const { data, error } = await supabase
      .from("gmv_30d")
      .select("mlb, gmv, unidades, share_pct, calculado_em")
      .in("mlb", unicos.slice(i, i + 150));
    if (error) {
      console.error("carregarGmv:", error.message);
      continue;
    }
    for (const g of data ?? []) {
      porMlb.set(g.mlb, { gmv: Number(g.gmv), unidades: g.unidades, share_pct: Number(g.share_pct) });
      calculadoEm ??= g.calculado_em;
    }
  }
  if (calculadoEm === null) {
    const { data } = await supabase.from("gmv_30d").select("calculado_em").limit(1).maybeSingle();
    calculadoEm = data?.calculado_em ?? null;
  }
  return { porMlb, calculadoEm };
}

/** Recalcula a foto no começo de uma rodada nova e devolve a linha de log.
 * Falha aqui não derruba a rodada — o share é informativo. */
export async function atualizarGmvNaRodada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  client: MercadoLivreClient,
  sellerId: number,
): Promise<string> {
  const t0 = Date.now();
  try {
    const r = await atualizarSnapshotGmv(supabase, client, sellerId);
    const brl = r.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    return `GMV 30 dias: ${brl} em ${r.pedidos} pedidos, ${r.porMlb.size} anúncios com venda (${((Date.now() - t0) / 1000).toFixed(1)}s).`;
  } catch (e) {
    return `[aviso] não deu pra atualizar o share de GMV (fica a foto anterior): ${e instanceof Error ? e.message : String(e)}`;
  }
}
