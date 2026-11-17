-- Painel de Catálogo: uma linha por MLB analisado numa rodada, com a
-- situação na disputa do buybox (GET /items/{id}/price_to_win) e, quando o
-- problema é preço, a campanha sugerida pra vencer. Os campos de campanha
-- seguem os mesmos nomes de campaign_decisions porque os dois painéis
-- gravam pelo mesmo caminho (src/lib/aplicarDecisao.ts).

create table catalog_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  mlb text not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,

  situacao text not null check (situacao in ('ganhando', 'preco', 'outro_motivo', 'nao_catalogo', 'erro')),
  status_competicao text,          -- status cru do ML: winning | competing | sharing_first_place | listed | ...
  motivos_ml text[],               -- reason[] cru do ML
  boosts_faltantes text[],         -- boosts que o vencedor tem ("boosted") e este item não ("opportunity")
  orientacao text,                 -- motivos traduzidos + o que fazer
  catalog_product_id text,
  vencedor_item_id text,
  vencedor_preco numeric,

  preco_atual numeric,             -- current_price do ML (já é o preço promocional vigente)
  preco_para_ganhar numeric,       -- price_to_win cru do ML
  preco_sugerido numeric,          -- price_to_win arredondado pra baixo (,90/,49)
  margem_sem_incentivo_pct numeric,
  margem_minima_pct numeric,       -- já resolvida pela cascata (estratégia > item > curva > geral)
  incentivo_necessario_valor numeric,  -- R$ de redução de tarifa que faltaria pra atingir a margem mínima
  incentivo_necessario_pct numeric,    -- mesmo valor, em % do preço sugerido
  sku_referencia text,

  promotion_id text,
  promotion_type text,
  offer_id text,
  preco_proposto numeric,          -- preço do item na campanha sugerida
  margem_campanha_pct numeric,
  reducao_tarifa_valor numeric,
  reducao_tarifa_fonte text,
  stock_sugerido integer,
  troca boolean not null default false,  -- true só quando é atualizar o preço da MESMA campanha já ativa (sai e reentra)
  campanha_anterior_id text,
  campanha_anterior_tipo text,
  campanha_anterior_offer_id text,

  gravavel boolean not null default false,
  motivo text not null,
  status text not null default 'info',   -- info | pendente | aplicada | erro
  resposta_api jsonb
);

create index catalog_decisions_run_idx on catalog_decisions (run_id);
create index catalog_decisions_created_at_idx on catalog_decisions (created_at desc);
create index catalog_decisions_mlb_idx on catalog_decisions (mlb);

alter table catalog_decisions enable row level security;
create policy "authenticated full access" on catalog_decisions
  for all to authenticated using (true) with check (true);
