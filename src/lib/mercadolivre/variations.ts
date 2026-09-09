import type { ItemDetail } from "./types";

function normalizeSku(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Acha a variação do item cujo atributo SELLER_SKU bate com o sku
 * informado. Retorna null se o item não tem variações, se sku for vazio
 * (item sem variação, usa o preço do anúncio como um todo), ou se o SKU
 * não for encontrado em nenhuma variação (nesse caso quem chama deve cair
 * pro preço do item e sinalizar o problema — nunca inventar um preço).
 */
export function findVariation(detail: ItemDetail, sku: string) {
  if (!sku || !detail.variations?.length) return null;
  const target = normalizeSku(sku);
  return (
    detail.variations.find((v) =>
      v.attributes?.some((a) => a.id === "SELLER_SKU" && normalizeSku(a.value_name ?? "") === target),
    ) ?? null
  );
}

/** Preço "atual" (não promocional) de uma variação — cai pro preço do item
 * se a variação não tiver preço próprio, ou se o sku não bater com nenhuma. */
export function resolveCurrentPrice(detail: ItemDetail, sku: string): { price: number | null; skuEncontrado: boolean } {
  const variation = findVariation(detail, sku);
  if (variation) return { price: variation.price ?? detail.price ?? null, skuEncontrado: true };
  return { price: detail.price ?? null, skuEncontrado: !sku || !detail.variations?.length };
}
