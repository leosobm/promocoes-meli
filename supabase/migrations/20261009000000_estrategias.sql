-- Estratégias: override temporário (com período de início/fim) de
-- margem mínima/alvo/tolerância, por item OU por curva — nível mais alto
-- da cascata de resolução (acima até da margem própria do item), usado só
-- enquanto a data de hoje está dentro do período da estratégia.

create table estrategias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data_inicio date not null,
  data_fim date not null,
  tipo_escopo text not null check (tipo_escopo in ('item', 'curva')),
  margem_minima_pct numeric,
  margem_alvo_pct numeric,
  margem_tolerancia_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estrategias_periodo_valido check (data_fim >= data_inicio)
);
comment on table estrategias is
  'Override temporário de margem, por item ou por curva, válido só durante [data_inicio, data_fim]. Campos de margem null caem pro próximo nível da cascata (item > curva > geral) mesmo com a estratégia ativa.';
comment on column estrategias.tipo_escopo is
  'item = alvo definido em estrategia_itens; curva = alvo definido em estrategia_curvas. Uma estratégia é de um tipo só.';

create index estrategias_periodo_idx on estrategias (data_inicio, data_fim);

create table estrategia_itens (
  estrategia_id uuid not null references estrategias (id) on delete cascade,
  mlb text not null,
  primary key (estrategia_id, mlb)
);
create index estrategia_itens_mlb_idx on estrategia_itens (mlb);

create table estrategia_curvas (
  estrategia_id uuid not null references estrategias (id) on delete cascade,
  curva text not null check (curva in ('A', 'B', 'C', 'D', 'Lançamento')),
  primary key (estrategia_id, curva)
);
create index estrategia_curvas_curva_idx on estrategia_curvas (curva);

alter table estrategias enable row level security;
alter table estrategia_itens enable row level security;
alter table estrategia_curvas enable row level security;
create policy "authenticated full access" on estrategias
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on estrategia_itens
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on estrategia_curvas
  for all to authenticated using (true) with check (true);
