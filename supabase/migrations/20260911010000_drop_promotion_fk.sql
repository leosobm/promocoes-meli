-- campaigns_cache nunca é populada pelo motor de decisão atual (ele lê
-- promoções por ITEM via /seller-promotions/items/{id}, não por campanha
-- via /seller-promotions/users/{id}) — a FK campaign_decisions.promotion_id
-- -> campaigns_cache(id) rejeitava toda decisão com promotion_id
-- preenchido. Remove a FK; promotion_id continua como texto simples.
alter table campaign_decisions drop constraint campaign_decisions_promotion_id_fkey;
