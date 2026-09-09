-- Suporte a itens com variação (mesmo MLB, SKUs diferentes) — a API de
-- Promoções do Mercado Livre grava deal_price a nível de MLB (confirmado em
-- pesquisa de documentação oficial em 2026-09-10: nenhum tipo de campanha
-- expõe variation_id ou aceita preço por variação). Por isso (mlb, sku)
-- passa a ser a chave composta em item_config — mlb sozinho não é mais
-- único — e o motor de decisão usa a variação de PIOR margem (maior custo)
-- como referência para decidir se uma campanha é segura pro MLB inteiro.

-- campaign_decisions não tem mais FK direta pra item_config(mlb) (deixou de
-- ser único) — mlb continua como texto simples, sem constraint referencial.
-- Precisa cair primeiro: é o que depende do índice único que vamos trocar.
alter table campaign_decisions drop constraint campaign_decisions_mlb_fkey;

alter table item_config drop constraint item_config_mlb_key;
alter table item_config alter column sku set not null;
alter table item_config alter column sku set default '';
update item_config set sku = '' where sku is null;
alter table item_config add constraint item_config_mlb_sku_key unique (mlb, sku);

alter table campaign_decisions add column sku_referencia text;
alter table campaign_decisions add column variacoes jsonb;

comment on column campaign_decisions.sku_referencia is
  'SKU da variação usada como referência (pior margem/maior custo) para decidir esta campanha — null se o item não tem variação.';
comment on column campaign_decisions.variacoes is
  'Array [{sku, cmv, margem_calculada_pct}] com a margem resultante calculada para CADA variação do MLB nesta campanha, para auditoria.';
