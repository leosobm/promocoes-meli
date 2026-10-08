-- Classificação ABC(D) por item, com estratégia de margem própria por
-- curva — terceiro nível de fallback na cascata de margem/tolerância:
-- item (item_config) > curva (curva_settings) > geral (app_settings).

alter table item_config add column curva text
  check (curva is null or curva in ('A', 'B', 'C', 'D'));
comment on column item_config.curva is
  'Classificação ABC(D) do item — opcional. Quando presente e a curva tiver margem/tolerância própria em curva_settings, é usada antes da geral do sistema (mas depois da margem do próprio item, se ela existir).';

create table curva_settings (
  curva text primary key check (curva in ('A', 'B', 'C', 'D')),
  margem_minima_pct numeric,
  margem_alvo_pct numeric,
  margem_tolerancia_pct numeric,
  updated_at timestamptz not null default now()
);
comment on table curva_settings is
  'Estratégia de margem por curva ABC(D) — cada campo null cai pro próximo nível do fallback (margem/tolerância geral em app_settings). Uma linha fixa por curva (A, B, C, D), sempre as 4 presentes.';

insert into curva_settings (curva) values ('A'), ('B'), ('C'), ('D');

alter table curva_settings enable row level security;
create policy "authenticated full access" on curva_settings
  for all to authenticated using (true) with check (true);
