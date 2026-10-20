-- Teto de margem — limite superior opcional na mesma cascata da margem
-- mínima/alvo (estratégia-item > estratégia-curva > item > curva > geral):
-- quando definido, o motor nunca escolhe/entra numa campanha cuja margem
-- resultante ultrapasse esse valor. Null em qualquer nível = sem teto
-- nesse nível, cai pro próximo (igual já funciona pra margem_alvo_pct).

alter table app_settings add column margem_teto_pct numeric;
comment on column app_settings.margem_teto_pct is
  'Teto de margem padrão do sistema — campanhas cuja margem resultante ultrapasse esse valor nunca são escolhidas/aderidas. Null = sem teto (comportamento anterior, sem limite superior).';

alter table curva_settings add column margem_teto_pct numeric;
comment on column curva_settings.margem_teto_pct is
  'Teto de margem desta curva. Null = usa o teto geral do sistema (app_settings.margem_teto_pct).';

alter table item_config add column margem_teto_pct numeric;
comment on column item_config.margem_teto_pct is
  'Teto de margem deste item específico. Null = usa o teto da curva (se tiver) ou o geral do sistema.';

alter table estrategias add column margem_teto_pct numeric;
comment on column estrategias.margem_teto_pct is
  'Teto de margem desta estratégia, com prioridade máxima na cascata enquanto ativa. Null = não sobrescreve o teto do item/curva/geral.';
