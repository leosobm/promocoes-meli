-- Comparação com a campanha já ativa (lida ao vivo da API) e recomendação
-- de troca, quando fizer sentido.
alter table campaign_decisions add column troca boolean not null default false;
alter table campaign_decisions add column campanha_anterior_id text;
alter table campaign_decisions add column campanha_anterior_tipo text;
alter table campaign_decisions add column campanha_anterior_offer_id text;
alter table campaign_decisions add column campanha_anterior_margem_pct numeric;
alter table campaign_decisions add column campanha_anterior_score numeric;

comment on column campaign_decisions.troca is
  'true = o item já estava numa campanha ativa (visto ao vivo na API) e esta decisão recomenda trocar pra outra — ver campanha_anterior_*.';
comment on column campaign_decisions.campanha_anterior_id is
  'promotion_id da campanha que estava ativa antes desta decisão (só quando troca=true) — necessário pra sair dela antes de entrar na nova.';
