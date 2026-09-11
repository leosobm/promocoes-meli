-- Tolerância global abaixo do piso de margem + campo de recomendação
-- normalizado (pra filtrar/ordenar no painel sem derivar client-side).

alter table app_settings add column margem_tolerancia_pct numeric not null default 0;
comment on column app_settings.margem_tolerancia_pct is
  'Percentual de tolerância sobre o piso (margem_minima_pct de cada item). Ex.: piso 12% + tolerância 10% = aceita opt-in manual a partir de 10,8%. 0 = sem tolerância (comportamento estrito de sempre).';

alter table campaign_decisions add column dentro_tolerancia boolean not null default false;
comment on column campaign_decisions.dentro_tolerancia is
  'true = fica abaixo do piso de margem mas dentro da tolerância configurada — nunca é escolhida automaticamente, exige opt-in manual explícito (status=tolerancia).';

alter table campaign_decisions add column recomendacao text;
comment on column campaign_decisions.recomendacao is
  'Classificação da decisão pra filtrar/ordenar no painel: nova_adesao | troca_campanha | diminuir_preco | aumentar_preco | mantida | tolerancia | rejeitada | sem_dados.';

create index campaign_decisions_recomendacao_idx on campaign_decisions (recomendacao);
create index campaign_decisions_margem_idx on campaign_decisions (margem_calculada_pct);
create index campaign_decisions_score_idx on campaign_decisions (score);
