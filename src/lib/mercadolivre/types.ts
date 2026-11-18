export type PromotionType =
  | "DEAL"
  | "SELLER_CAMPAIGN"
  | "MARKETPLACE_CAMPAIGN"
  | "BANK"
  | "PRE_NEGOTIATED"
  | "VOLUME"
  | "LIGHTNING"
  | "DOD"
  | "SMART"
  | "PRICE_MATCHING"
  | "UNHEALTHY_STOCK"
  | "SELLER_COUPON_CAMPAIGN"
  | string; // outros tipos que a API venha a retornar e ainda não mapeamos

export interface MLTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
}

export interface Campaign {
  id: string;
  type: PromotionType;
  name?: string;
  status?: string;
  start_date?: string;
  finish_date?: string;
  raw?: unknown;
}

/**
 * Uma promoção candidata/ativa para UM item específico, como retornada por
 * GET /seller-promotions/items/{item_id}?app_version=v2 — fonte primária
 * (ver AVISOS.md: 1 chamada traz todas as campanhas do item, com preço,
 * original_price e os campos de boost já resolvidos).
 */
export interface ItemPromotion {
  promotion_id: string;
  promotion_type: PromotionType;
  status?: string;
  offer_id?: string;
  price?: number | null;
  original_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  boosted_offer?: boolean;
  discount_meli_boosted_percentage?: number | null;
  discount_meli_boost_amount?: number | null;
  total_price_for_boosted_offer?: number | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  benefits?: { meli_percent?: number | null } | null;
  // Só presente em tipos com reserva de estoque pra campanha (LIGHTNING) —
  // min/max = faixa aceita pela API no join; remaining_stock = quanto
  // ainda resta reservado numa oferta já ativa.
  stock?: { min?: number; max?: number; remaining_stock?: number } | null;
  raw?: unknown;
}

export interface ItemDetail {
  id: string;
  title?: string;
  price?: number;
  available_quantity?: number;
  category_id?: string;
  listing_type_id?: string;
  status?: string;
  // true = anúncio de catálogo (disputa o buybox). Ter catalog_product_id
  // sozinho não basta: anúncio tradicional vinculado a um produto também
  // tem esse campo, mas não compete (visto na prática: 1355 casos assim).
  catalog_listing?: boolean;
  catalog_product_id?: string | null;
  shipping?: {
    logistic_type?: string;
    mode?: string;
    dimensions?: string;
    free_shipping?: boolean;
  };
  attributes?: { id: string; value_name?: string }[];
  variations?: {
    id?: number;
    price?: number | null;
    attributes?: { id: string; value_name?: string }[];
  }[];
}

export interface CommissionResult {
  ok: boolean;
  sale_fee_amount?: number;
  percentage_fee?: number;
  fixed_fee?: number;
  error?: string;
}

export interface FreeShippingCostResult {
  ok: boolean;
  list_cost?: number;
  method?: string;
  error?: string;
}

export interface CatalogBoost {
  id: string;
  status: string; // boosted | not_boosted | opportunity | not_apply
  description?: string;
}

/** GET /items/{id}/price_to_win?version=v2 — `current_price` já é o preço
 * promocional vigente (confirmado contra /sale_price), e `price_to_win` já
 * desconta os boosts de cada lado (ex.: 43,75 pra vencer um concorrente a
 * 39,90 porque o item tem envio no mesmo dia e o vencedor não). */
export interface PriceToWin {
  item_id: string;
  current_price: number | null;
  price_to_win: number | null;
  status: string; // winning | competing | sharing_first_place | listed | not_listed
  reason?: string[];
  visit_share?: string | null;
  competitors_sharing_first_place?: number | null;
  catalog_product_id?: string | null;
  boosts?: CatalogBoost[];
  winner?: { item_id: string; price: number | null; boosts?: CatalogBoost[] } | null;
}

/** Só os campos de /orders/search usados no cálculo de GMV. */
export interface OrderResumo {
  id: number;
  status: string; // paid | cancelled | invalid | partially_refunded | ...
  order_items: { item: { id: string }; quantity: number; unit_price: number }[];
}

export interface JoinResult {
  ok: boolean;
  status_code: number | null;
  response: unknown;
  sent: unknown;
}
