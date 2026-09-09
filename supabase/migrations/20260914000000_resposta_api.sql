-- Guarda a resposta bruta da API em toda tentativa de gravação (sucesso ou
-- erro) — antes só ficava registrada em caso de erro, o que impediu
-- diagnosticar um caso real onde o Mercado Livre respondeu 2xx pra um
-- join numa campanha já iniciada (SELLER_CAMPAIGN) sem de fato atualizar
-- o preço vigente.
alter table campaign_decisions add column resposta_api jsonb;
comment on column campaign_decisions.resposta_api is
  'Resposta bruta da API do ML na tentativa de join/leave (sucesso ou erro) — pra auditoria quando um 2xx não refletir a mudança esperada no ML.';
