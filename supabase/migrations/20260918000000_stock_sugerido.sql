-- LIGHTNING exige reservar um "stock" no join, dentro de uma faixa
-- min/max devolvida pela própria API — sem isso, o Mercado Livre rejeita
-- com "Stock must be greater than X and less than Y" na hora de aplicar,
-- mesmo com a decisão já calculada e aprovada na revisão (visto na
-- prática: dezenas de tentativas de adesão falhando por esse motivo).
alter table campaign_decisions add column stock_sugerido integer;
comment on column campaign_decisions.stock_sugerido is
  'Quantidade de estoque a reservar no join de campanhas que exigem isso (hoje só LIGHTNING) — calculado como min(estoque disponível do anúncio, máximo aceito pela campanha). Null = tipo não exige stock, ou dados insuficientes pra calcular.';
