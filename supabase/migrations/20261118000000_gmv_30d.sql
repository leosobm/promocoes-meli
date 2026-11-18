-- Share de GMV dos últimos 30 dias por MLB (pedidos do vendedor via
-- /orders/search, cancelados fora). Foto única, recalculada no início de
-- cada rodada do Painel ou do Catálogo: as telas cruzam por mlb.
-- share_pct = gmv do MLB / gmv total da conta no período, em % (0–100).

create table gmv_30d (
  mlb text primary key,
  gmv numeric not null,
  unidades integer not null,
  pedidos integer not null,
  share_pct numeric not null,
  periodo_de timestamptz not null,
  periodo_ate timestamptz not null,
  calculado_em timestamptz not null
);

create index gmv_30d_calculado_em_idx on gmv_30d (calculado_em);

alter table gmv_30d enable row level security;
create policy "authenticated full access" on gmv_30d
  for all to authenticated using (true) with check (true);
