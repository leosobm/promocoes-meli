-- BANK (co-participação Banco/PIX) exige meli_percentage E seller_percentage
-- no corpo do POST de adesão (PIX_OPTIN_PERCENTAGE_NULL_ERROR sem isso,
-- visto em produção) — meli_percentage já tínhamos (ml_participacao_pct),
-- faltava seller_percentage pra montar o payload completo na hora de
-- aplicar (ver client.ts joinItem / aplicar/route.ts).
alter table campaign_decisions add column seller_percentage numeric;
comment on column campaign_decisions.seller_percentage is
  'seller_percentage bruto da oferta (quanto o vendedor banca do desconto) — hoje usado só pra montar o payload de adesão de campanhas BANK, que exige esse campo junto com meli_percentage.';
