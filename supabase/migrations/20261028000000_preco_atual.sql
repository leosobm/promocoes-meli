-- Preço atual (o que o item realmente vende por agora, antes da decisão
-- proposta) — pra mostrar lado a lado com preco_proposto no painel. É o
-- menor preço entre as campanhas ATIVAS do item no momento do cálculo
-- (o ML exibe o menor preço entre ofertas ativas simultâneas), ou o
-- preço regular do anúncio quando nenhuma campanha está ativa.

alter table campaign_decisions add column preco_atual numeric;
comment on column campaign_decisions.preco_atual is
  'Preço vigente do item ANTES da decisão proposta — menor preço entre campanhas ativas, ou preço regular do anúncio se nenhuma estiver ativa. Mesmo valor em todas as linhas de um MLB na mesma rodada.';
