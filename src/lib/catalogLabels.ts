// Sem dependências de servidor — usado tanto pelo motor quanto pela UI.

export const MOTIVO_CATALOGO: Record<string, { rotulo: string; orientacao: string }> = {
  non_trusted_seller: {
    rotulo: "Conta marcada como vendedor não confiável",
    orientacao: "O ML não deixa competir enquanto a conta tiver essa marcação — só o suporte do Mercado Livre resolve.",
  },
  reputation_below_threshold: {
    rotulo: "Reputação abaixo do exigido",
    orientacao: "Só volta a competir quando a reputação da conta atingir o nível exigido pelo catálogo.",
  },
  winner_has_better_reputation: {
    rotulo: "Vencedor com reputação melhor",
    orientacao: "O vencedor leva por reputação mesmo com preço parecido — reduzir atrasos, cancelamentos e reclamações é o caminho.",
  },
  // Fora da doc oficial — visto em produção em 2026-11-17.
  reputation_limit_reached: {
    rotulo: "Limite de vendas da reputação atingido",
    orientacao: "A conta bateu o teto de vendas permitido pra reputação atual neste produto — só libera com melhora de reputação ou na virada do período.",
  },
  manufacturing_time: {
    rotulo: "Anúncio com prazo de fabricação",
    orientacao: "Quem tem estoque imediato ganha — remova o prazo de fabricação se o item já estiver em estoque.",
  },
  temporarily_winning_manufacturing_time: {
    rotulo: "Ganhando temporariamente (prazo de fabricação)",
    orientacao: "Perde assim que aparecer um concorrente com estoque imediato — remova o prazo de fabricação se possível.",
  },
  temporarily_competing_manufacturing_time: {
    rotulo: "Competindo temporariamente (prazo de fabricação)",
    orientacao: "Só compete porque ninguém tem estoque imediato — remova o prazo de fabricação se possível.",
  },
  temporarily_winning_best_reputation_available: {
    rotulo: "Ganhando temporariamente (melhor reputação disponível)",
    orientacao: "Perde se entrar um vendedor com reputação verde — melhorar a reputação garante a posição.",
  },
  temporarily_competing_best_reputation_available: {
    rotulo: "Competindo temporariamente (melhor reputação disponível)",
    orientacao: "Volta a só ser listado se entrar um vendedor com reputação melhor.",
  },
  // Normalmente só aparece em anúncio tradicional, mas visto em 2026-11-17
  // num anúncio com catalog_listing=true (status "not_listed").
  item_not_opted_in: {
    rotulo: "Fora da disputa do catálogo",
    orientacao: "O ML não considera esta publicação na competição (opt-in não concluído) — confira no painel do ML se ela está vinculada ao produto de catálogo.",
  },
  item_paused: {
    rotulo: "Anúncio pausado",
    orientacao: "Reative o anúncio (confira o estoque) pra voltar a competir.",
  },
  shipping_mode: {
    rotulo: "Modo de envio inferior ao do vencedor",
    orientacao: "O ML prioriza Mercado Envios 2 > Mercado Envios 1 > envio próprio — migre o anúncio pro Mercado Envios.",
  },
  newbie_program_seller: {
    rotulo: "Limite do programa de vendedor iniciante",
    orientacao: "A conta atingiu o limite de vendas do programa de decolagem — o ML libera gradualmente.",
  },
  // Fora da doc oficial — visto em produção em 2026-11-17: price_to_win
  // igual ao preço atual e vencedor MAIS CARO, mas com Full + frete grátis
  // + envio no mesmo dia que este item não tem.
  no_improvement_price: {
    rotulo: "Baixar o preço não resolve",
    orientacao: "A diferença está nas condições de venda, não no preço — veja os benefícios que o vencedor tem e você não.",
  },
};

export const BOOST_CATALOGO: Record<string, { rotulo: string; acao: string }> = {
  fulfillment: { rotulo: "Full", acao: "enviar estoque pro Mercado Envios Full" },
  free_installments: { rotulo: "Parcelamento sem juros", acao: "oferecer parcelamento sem juros" },
  free_shipping: { rotulo: "Frete grátis", acao: "oferecer frete grátis" },
  shipping_collect: { rotulo: "Coleta", acao: "usar Mercado Envios Coleta" },
  same_day_shipping: { rotulo: "Envio no mesmo dia", acao: "habilitar envio no mesmo dia (Flex ou Full)" },
  shipping_quarantine: { rotulo: "Envio normal", acao: "regularizar o envio" },
};

export function rotuloBoost(id: string): string {
  return BOOST_CATALOGO[id]?.rotulo ?? id;
}
