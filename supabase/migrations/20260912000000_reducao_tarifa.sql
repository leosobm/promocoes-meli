-- Visibilidade explícita do incentivo do Mercado Livre via redução de
-- tarifa/comissão (campos boosted_offer / discount_meli_boosted_percentage
-- / discount_meli_boost_amount da API — confirmado com valor EXATO em R$,
-- não estimado). Distinto de ml_participacao_pct, que mistura esse sinal
-- com meli_percentage (financiamento do desconto de preço) só pra fins de
-- pontuação — aqui é a redução de tarifa isolada, pro usuário auditar.
alter table campaign_decisions add column reducao_tarifa boolean not null default false;
alter table campaign_decisions add column reducao_tarifa_pct numeric;
alter table campaign_decisions add column reducao_tarifa_valor numeric;

comment on column campaign_decisions.reducao_tarifa is
  'true se a oferta tem boosted_offer/discount_meli_boosted_percentage/discount_meli_boost_amount — o ML está bancando parte da SUA comissão, não só do preço.';
comment on column campaign_decisions.reducao_tarifa_valor is
  'Valor EXATO em R$ da redução de tarifa (discount_meli_boost_amount) — vem pronto da API, não é estimativa.';
