import { getStoredTokens, saveTokens } from "./tokens";
import type {
  Campaign,
  CommissionResult,
  FreeShippingCostResult,
  ItemDetail,
  ItemPromotion,
  JoinResult,
  PromotionType,
} from "./types";
import { getCampaignTypeConfig } from "./campaignTypes";

const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const API_BASE = "https://api.mercadolibre.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export function buildAuthorizationUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env("ML_CLIENT_ID"),
    redirect_uri: env("ML_REDIRECT_URI"),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Troca o "code" do callback OAuth por access_token/refresh_token e salva. */
export async function exchangeCodeForTokens(code: string): Promise<void> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      code,
      redirect_uri: env("ML_REDIRECT_URI"),
    }),
  });
  const d = await resp.json();
  if (!d.access_token) {
    throw new Error(`Falha ao trocar code por token: ${JSON.stringify(d)}`);
  }
  await saveTokens(d.access_token, d.refresh_token ?? "", d.expires_in ?? null);
}

async function refreshTokens(refreshToken: string): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      refresh_token: refreshToken,
    }),
  });
  const d = await resp.json();
  if (!d.access_token) {
    throw new Error(`Falha ao renovar token: ${JSON.stringify(d)}`);
  }
  await saveTokens(d.access_token, d.refresh_token ?? refreshToken, d.expires_in ?? null);
  return d.access_token;
}

export class NotConnectedError extends Error {
  constructor() {
    super("Conta do Mercado Livre não conectada.");
  }
}

/** O Mercado Livre nem sempre devolve refresh_token na troca do code (visto
 * na prática, causa não confirmada — ver README). Sem ele não dá pra
 * renovar sozinho: quando o access_token expira, só reconectando de novo. */
export class TokenExpiredError extends Error {
  constructor() {
    super(
      "O access_token do Mercado Livre expirou e esta conexão não tem refresh_token para renovar " +
        "sozinha. Clique em \"Conectar Mercado Livre\" de novo para reautorizar.",
    );
  }
}

export class MercadoLivreClient {
  private accessToken: string;
  private refreshToken: string;

  private constructor(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /** Carrega os tokens salvos. Com refresh_token, renova primeiro (garante
   * validade pelo resto da execução, que pode envolver muitas chamadas em
   * sequência). Sem refresh_token (o ML às vezes não devolve um — ver
   * TokenExpiredError), usa o access_token salvo enquanto ainda for válido. */
  static async fromStore(): Promise<MercadoLivreClient> {
    const stored = await getStoredTokens();
    if (!stored || !stored.access_token) throw new NotConnectedError();

    if (stored.refresh_token) {
      const fresh = await refreshTokens(stored.refresh_token);
      return new MercadoLivreClient(fresh, stored.refresh_token);
    }

    const expiresAtMs = stored.expires_at ? new Date(stored.expires_at).getTime() : null;
    const aindaValido = expiresAtMs !== null && expiresAtMs - Date.now() > 60_000;
    if (!aindaValido) throw new TokenExpiredError();
    return new MercadoLivreClient(stored.access_token, "");
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    opts: { params?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<{ status: number; data: T }> {
    const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resp = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });

        if (resp.status === 401 && attempt === 0) {
          if (!this.refreshToken) throw new TokenExpiredError();
          this.accessToken = await refreshTokens(this.refreshToken);
          continue;
        }

        let data: T;
        try {
          data = (await resp.json()) as T;
        } catch {
          data = {} as T;
        }
        return { status: resp.status, data };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 15000)));
      }
    }
    throw new Error(`Falha de rede após várias tentativas: ${String(lastErr)}`);
  }

  async getUserId(): Promise<number> {
    const { status, data } = await this.request<{ id: number }>("GET", "/users/me");
    if (status !== 200) throw new Error(`Falha ao obter usuário: ${JSON.stringify(data)}`);
    return data.id;
  }

  async getUserPromotions(userId: number): Promise<Campaign[]> {
    const { status, data } = await this.request<{ results?: Campaign[] } | Campaign[]>(
      "GET",
      `/seller-promotions/users/${userId}`,
      { params: { app_version: "v2" } },
    );
    if (status !== 200) return [];
    return Array.isArray(data) ? data : data.results ?? [];
  }

  /**
   * Fonte primária de promoções por item — 1 chamada traz TODAS as
   * campanhas (candidatas e ativas) daquele MLB, já com price/original_price
   * e os campos de boost resolvidos. Preferir a este endpoint a enumerar
   * item por item dentro de cada campanha.
   */
  async getItemPromotions(itemId: string): Promise<ItemPromotion[]> {
    const { status, data } = await this.request<{ results?: ItemPromotion[] } | ItemPromotion[]>(
      "GET",
      `/seller-promotions/items/${itemId}`,
      { params: { app_version: "v2" } },
    );
    if (status !== 200) return [];
    const list = Array.isArray(data) ? data : data.results ?? [];
    return list.map((p) => ({ ...p, raw: p }));
  }

  /**
   * Enumera todos os itens de UMA campanha — paginação via cursor
   * `search_after` (TTL de 5 min, não dá pra "voltar"), NÃO offset/limit.
   * Usar só quando precisar de todos os itens de uma campanha específica
   * (ex.: campanhas do tipo VOLUME, cujo desconto é definido a nível de
   * campanha, não de item). `statusItem`: 'active' | 'paused' — a API só
   * retorna itens ativos se esse parâmetro não for enviado.
   */
  async getPromotionItems(
    promotionId: string,
    promotionType: string,
    statusItem?: "active" | "paused",
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let searchAfter: string | undefined;
    for (let page = 0; page < 500; page++) {
      const { status, data } = await this.request<{
        results?: unknown[];
        paging?: { searchAfter?: string; search_after?: string };
      }>("GET", `/seller-promotions/promotions/${promotionId}/items`, {
        params: {
          promotion_type: promotionType,
          app_version: "v2",
          status_item: statusItem,
          search_after: searchAfter,
        },
      });
      if (status !== 200 || !data.results || data.results.length === 0) break;
      items.push(...data.results);
      const next = data.paging?.searchAfter ?? data.paging?.search_after;
      if (!next || next === searchAfter) break;
      searchAfter = next;
    }
    return items;
  }

  /**
   * Detalhe completo de UM item, incluindo variations[].attributes (onde dá
   * pra achar o SELLER_SKU de cada variação) — o multiget /items?ids=...
   * não traz isso por padrão, precisa de include_attributes=all.
   */
  async getItemDetail(id: string): Promise<ItemDetail | null> {
    const { status, data } = await this.request<ItemDetail>("GET", `/items/${id}`, {
      params: { include_attributes: "all" },
    });
    if (status !== 200) return null;
    return data;
  }

  async getItemsDetails(ids: string[]): Promise<Map<string, ItemDetail>> {
    const out = new Map<string, ItemDetail>();
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const { status, data } = await this.request<
        { code: number; body: ItemDetail }[]
      >("GET", "/items", { params: { ids: chunk.join(",") } });
      if (status !== 200 || !Array.isArray(data)) continue;
      for (const entry of data) {
        if (entry.code === 200 && entry.body) out.set(entry.body.id, entry.body);
      }
    }
    return out;
  }

  async getCommission(item: ItemDetail): Promise<CommissionResult> {
    if (!item.price || !item.category_id) {
      return { ok: false, error: "item sem price/category_id para calcular comissão" };
    }
    const { status, data } = await this.request<
      { sale_fee_amount?: number; sale_fee_details?: { percentage_fee?: number; fixed_fee?: number } }[]
      | { sale_fee_amount?: number; sale_fee_details?: { percentage_fee?: number; fixed_fee?: number } }
    >("GET", "/sites/MLB/listing_prices", {
      params: {
        price: item.price,
        category_id: item.category_id,
        listing_type_id: item.listing_type_id,
        logistic_type: item.shipping?.logistic_type,
        shipping_mode: item.shipping?.mode,
      },
    });
    if (status !== 200) return { ok: false, error: `${status}: ${JSON.stringify(data)}` };
    const entry = Array.isArray(data)
      ? data.find((e) => e.sale_fee_amount !== undefined) ?? data[0]
      : data;
    if (!entry) return { ok: false, error: "resposta sem dados de comissão" };
    return {
      ok: true,
      sale_fee_amount: entry.sale_fee_amount,
      percentage_fee: entry.sale_fee_details?.percentage_fee,
      fixed_fee: entry.sale_fee_details?.fixed_fee,
    };
  }

  async getFreeShippingCost(userId: number, item: ItemDetail): Promise<FreeShippingCostResult> {
    const { status, data } = await this.request<{
      coverage?: { all_country?: { list_cost?: number } };
    }>("GET", `/users/${userId}/shipping_options/free`, {
      params: { item_id: item.id, free_shipping: "True", verbose: "true" },
    });
    const coverage = data?.coverage?.all_country;
    if (status === 200 && coverage) {
      return { ok: true, method: "item_id", list_cost: coverage.list_cost };
    }

    const dims = item.shipping?.dimensions;
    if (!dims || !item.price) {
      return { ok: false, error: "sem cobertura por item_id e sem dimensões para fallback" };
    }
    const { status: status2, data: data2 } = await this.request<{
      coverage?: { all_country?: { list_cost?: number } };
    }>("GET", `/users/${userId}/shipping_options/free`, {
      params: {
        dimensions: dims,
        item_price: item.price,
        free_shipping: "True",
        verbose: "true",
        category_id: item.category_id,
        listing_type_id: item.listing_type_id,
        logistic_type: item.shipping?.logistic_type,
      },
    });
    const coverage2 = data2?.coverage?.all_country;
    if (status2 === 200 && coverage2) {
      return { ok: true, method: "dimensions (fallback)", list_cost: coverage2.list_cost };
    }
    return { ok: false, error: "sem cobertura de frete grátis (item_id e fallback falharam)" };
  }

  /**
   * Adere a uma campanha para um item — payload por tipo (ver
   * campaignTypes.ts, todos confirmados em doc oficial). Nunca adivinha:
   * tipos não mapeados em CAMPAIGN_TYPES têm writeSupported=false e são
   * rejeitados antes de chamar a API.
   */
  async joinItem(
    mlb: string,
    promotionId: string,
    promotionType: PromotionType,
    opts: { dealPrice?: number; topDealPrice?: number; offerId?: string; stock?: number } = {},
  ): Promise<JoinResult> {
    const cfg = getCampaignTypeConfig(promotionType);
    if (!cfg.writeSupported) {
      return {
        ok: false,
        status_code: null,
        response: `promotion_type '${promotionType}' sem payload de adesão confirmado`,
        sent: null,
      };
    }
    const body: Record<string, unknown> = { promotion_id: promotionId, promotion_type: promotionType };
    if (cfg.priceMode === "seller_defined") {
      body.deal_price = opts.dealPrice;
      if (opts.topDealPrice) body.top_deal_price = opts.topDealPrice;
    }
    if (cfg.requiresOfferId) body.offer_id = opts.offerId;
    if (cfg.extraJoinFields === "stock") body.stock = opts.stock;

    const { status, data } = await this.request(
      "POST",
      `/seller-promotions/items/${mlb}`,
      { params: { app_version: "v2" }, body },
    );
    return { ok: status >= 200 && status < 300, status_code: status, response: data, sent: body };
  }

  async leaveItem(
    mlb: string,
    promotionId: string,
    promotionType: PromotionType,
    opts: { offerId?: string; currentStatus?: string } = {},
  ): Promise<JoinResult> {
    const cfg = getCampaignTypeConfig(promotionType);
    if (!cfg.canDeleteAfterActive) {
      const started = ["started", "active", "in_progress"].includes(
        (opts.currentStatus ?? "").toLowerCase(),
      );
      if (started) {
        return {
          ok: false,
          status_code: null,
          response:
            `${promotionType}: não é possível remover uma oferta já ativa (confirmado na doc oficial) ` +
            `— a única saída é pausar o anúncio.`,
          sent: null,
        };
      }
    }
    const params: Record<string, string> = {
      promotion_type: promotionType,
      promotion_id: promotionId,
      app_version: "v2",
    };
    if (cfg.deleteRequiresOfferId && opts.offerId) params.offer_id = opts.offerId;

    const { status, data } = await this.request("DELETE", `/seller-promotions/items/${mlb}`, {
      params,
    });
    return { ok: status >= 200 && status < 300, status_code: status, response: data, sent: params };
  }
}
