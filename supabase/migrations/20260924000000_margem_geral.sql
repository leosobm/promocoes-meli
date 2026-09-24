-- Margem mínima e margem alvo globais (app_settings) — usadas quando o
-- item não tem sua própria margem definida em item_config. Regra: item
-- com margem cadastrada usa a do item; sem isso, usa a geral do sistema.

alter table app_settings add column margem_minima_pct numeric not null default 12;
comment on column app_settings.margem_minima_pct is
  'Margem mínima padrão do sistema — usada para qualquer item SEM margem_minima_pct definida em item_config (fallback, não sobrescreve o que já está cadastrado por item).';

alter table app_settings add column margem_alvo_pct numeric;
comment on column app_settings.margem_alvo_pct is
  'Margem alvo padrão do sistema — usada para qualquer item SEM margem_alvo_pct definida em item_config, antes de cair no último fallback (a própria margem mínima efetiva do item). Null = sem alvo padrão, cai direto na margem mínima.';

-- margem_minima_pct deixa de ser obrigatória por item — passa a poder
-- ficar em branco no cadastro pra usar a geral do sistema acima.
alter table item_config alter column margem_minima_pct drop not null;
comment on column item_config.margem_minima_pct is
  'Margem mínima deste item específico. Null = usa app_settings.margem_minima_pct (a geral do sistema).';
comment on column item_config.margem_alvo_pct is
  'Margem alvo deste item específico. Null = usa app_settings.margem_alvo_pct (a geral do sistema), e se essa também for null, usa a margem mínima efetiva do item.';
