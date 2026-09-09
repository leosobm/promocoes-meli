import type { PromotionType } from "./types";

/**
 * Configuração de gravação (POST/DELETE) por tipo de campanha —
 * confirmada em documentação oficial (developers.mercadolibre.com /
 * developers.mercadolivre.com.br), páginas dedicadas por tipo, pesquisadas
 * em 2026-09-09. NÃO editar sem confirmar a doc oficial de novo — um
 * payload errado pode fixar um preço promocional incorreto num anúncio
 * ativo (risco comercial real, não só bug de software).
 *
 * priceMode:
 *   - "seller_defined": o vendedor define deal_price (o sistema calcula o
 *     menor preço que ainda respeita a margem mínima/alvo).
 *   - "fixed_by_ml": o preço já vem fixado pela API (candidato) — o
 *     sistema só decide aceitar ou não.
 *   - "no_price": a campanha não tem preço por item (desconto definido na
 *     criação da campanha, ou cupom aplicado no checkout).
 */
export interface CampaignTypeConfig {
  type: PromotionType;
  label: string;
  writeSupported: boolean;
  priceMode: "seller_defined" | "fixed_by_ml" | "no_price";
  requiresOfferId: boolean; // no POST de adesão
  extraJoinFields?: "stock"; // LIGHTNING exige "stock" reservado
  deleteRequiresOfferId: boolean;
  canDeleteAfterActive: boolean; // false = doc diz explicitamente que não dá pra remover depois de ativa
  sourceUrl: string;
}

export const CAMPAIGN_TYPES: Record<string, CampaignTypeConfig> = {
  DEAL: {
    type: "DEAL",
    label: "Tradicional (DEAL)",
    writeSupported: true,
    priceMode: "seller_defined",
    requiresOfferId: false,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: true,
    sourceUrl: "confirmado na prática (mercadolivre_adesao_campanhas.py)",
  },
  SELLER_CAMPAIGN: {
    type: "SELLER_CAMPAIGN",
    label: "Campanha do Vendedor",
    writeSupported: true,
    priceMode: "seller_defined",
    requiresOfferId: false,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: true,
    sourceUrl: "confirmado na prática (mercadolivre_adesao_campanhas.py)",
  },
  MARKETPLACE_CAMPAIGN: {
    type: "MARKETPLACE_CAMPAIGN",
    label: "Cofinanciada (Marketplace)",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: false,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: true,
    sourceUrl: "confirmado na prática (mercadolivre_adesao_campanhas.py)",
  },
  BANK: {
    type: "BANK",
    label: "Co-participação (Banco/PIX)",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: true,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: true,
    sourceUrl: "confirmado na prática (mercadolivre_adesao_campanhas.py)",
  },
  PRE_NEGOTIATED: {
    type: "PRE_NEGOTIATED",
    label: "Pré-Acordado por Item",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: true,
    deleteRequiresOfferId: true,
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/pre-negotiated-discount-per-item",
  },
  VOLUME: {
    type: "VOLUME",
    label: "Desconto por Volume",
    writeSupported: true,
    priceMode: "no_price",
    requiresOfferId: false,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/volume-discount-campaigns",
  },
  LIGHTNING: {
    type: "LIGHTNING",
    label: "Oferta Relâmpago",
    writeSupported: true,
    priceMode: "seller_defined",
    requiresOfferId: false,
    extraJoinFields: "stock",
    deleteRequiresOfferId: false,
    canDeleteAfterActive: false, // doc: "Once activated, offers cannot be deleted" — só pausar o anúncio
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/lightning-deal",
  },
  DOD: {
    type: "DOD",
    label: "Oferta do Dia",
    writeSupported: true,
    priceMode: "seller_defined",
    requiresOfferId: false,
    deleteRequiresOfferId: false,
    canDeleteAfterActive: false, // mesma restrição do LIGHTNING
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/daily-deal",
  },
  SMART: {
    type: "SMART",
    label: "Cofinanciada Smart",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: true,
    deleteRequiresOfferId: true,
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/smart-campaigns",
  },
  PRICE_MATCHING: {
    type: "PRICE_MATCHING",
    label: "Preço Competitivo",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: true,
    deleteRequiresOfferId: true,
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/smart-campaigns",
  },
  UNHEALTHY_STOCK: {
    type: "UNHEALTHY_STOCK",
    label: "Liquidação Estoque Full",
    writeSupported: true,
    priceMode: "fixed_by_ml",
    requiresOfferId: true,
    deleteRequiresOfferId: true,
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.ar/en_us/pre-negotiated-discount-per-item",
  },
  SELLER_COUPON_CAMPAIGN: {
    type: "SELLER_COUPON_CAMPAIGN",
    label: "Cupom do Vendedor",
    writeSupported: true,
    priceMode: "no_price",
    requiresOfferId: false,
    deleteRequiresOfferId: false, // particularidade: DELETE não aceita offer_id neste tipo
    canDeleteAfterActive: true,
    sourceUrl: "https://developers.mercadolibre.com.bo/en_us/seller-coupon",
  },
};

export function getCampaignTypeConfig(type: string): CampaignTypeConfig {
  return (
    CAMPAIGN_TYPES[type] ?? {
      type,
      label: type,
      writeSupported: false,
      priceMode: "no_price",
      requiresOfferId: false,
      deleteRequiresOfferId: false,
      canDeleteAfterActive: true,
      sourceUrl: "tipo desconhecido — payload não confirmado, somente leitura",
    }
  );
}
