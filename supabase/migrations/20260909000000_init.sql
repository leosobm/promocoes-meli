-- Schema inicial — Painel de Promoções Mercado Livre
-- Confirmado com o usuário em 2026-09-09 (ver histórico da conversa).

-- ---------------------------------------------------------------------------
-- app_settings: config global (não é por item) — linha única (id = 1)
-- ---------------------------------------------------------------------------
create table app_settings (
  id int primary key default 1,
  taxas_pct numeric not null default 0,       -- "Taxas" da planilha (imposto/antecipação etc.), % sobre o preço
  peso_desconto_pct numeric not null default 40,  -- peso do fator "desconto ao consumidor" no score (0-100)
  peso_ml_pct numeric not null default 35,        -- peso do fator "participação do ML" no score (0-100)
  peso_margem_pct numeric not null default 25,    -- peso do fator "margem resultante" no score (0-100)
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into app_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- item_config: custo (CMV) e faixa de margem aceitável por item — substitui
-- o CSV manual dos scripts locais; alimentado via upload na interface.
-- ---------------------------------------------------------------------------
create table item_config (
  id uuid primary key default gen_random_uuid(),
  mlb text unique not null,
  sku text,
  cmv numeric not null,
  margem_minima_pct numeric not null,
  margem_alvo_pct numeric,
  participar_campanhas boolean not null default true,
  updated_at timestamptz not null default now()
);

create index item_config_sku_idx on item_config (sku);

-- ---------------------------------------------------------------------------
-- items_cache: dados do anúncio sincronizados da API (título/categoria/
-- preço/SKU/tipo de anúncio/shipping) — evita reconsultar a API toda hora
-- só para exibir no painel.
-- ---------------------------------------------------------------------------
create table items_cache (
  mlb text primary key,
  title text,
  category_id text,
  price numeric,
  sku text,
  listing_type_id text,
  shipping jsonb,
  status text,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- campaigns_cache: campanhas lidas de /seller-promotions/users/{id}
-- ---------------------------------------------------------------------------
create table campaigns_cache (
  id text primary key,           -- promotion_id do Mercado Livre (ex.: P-MLB1806019)
  type text not null,
  name text,
  status text,
  start_date timestamptz,
  finish_date timestamptz,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- campaign_decisions: decisão calculada por item/campanha — histórico e
-- fila do que será (ou foi) aplicado.
-- ---------------------------------------------------------------------------
create table campaign_decisions (
  id uuid primary key default gen_random_uuid(),
  mlb text not null references item_config (mlb) on delete cascade,
  promotion_id text references campaigns_cache (id) on delete set null,
  promotion_type text not null,
  offer_id text,
  preco_proposto numeric,
  preco_original numeric,
  margem_calculada_pct numeric,
  desconto_consumidor_pct numeric,
  ml_participacao_pct numeric,
  ml_participacao_fonte text,     -- 'discount_meli_boosted_percentage' | 'meli_percentage' | null
  score numeric,
  escolhida boolean not null default false,   -- true = melhor campanha para este item nesta rodada
  gravavel boolean not null default false,    -- false = tipo sem payload de escrita confirmado/permitido
  motivo text not null,
  status text not null default 'pendente',    -- pendente | aplicada | rejeitada | erro
  run_id uuid,                    -- agrupa decisões da mesma execução de "Atualizar agora"
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index campaign_decisions_mlb_idx on campaign_decisions (mlb);
create index campaign_decisions_run_idx on campaign_decisions (run_id);
create index campaign_decisions_status_idx on campaign_decisions (status);

-- ---------------------------------------------------------------------------
-- ml_tokens: credenciais OAuth do Mercado Livre — NUNCA acessível via anon/
-- authenticated (RLS habilitado, sem nenhuma policy = acesso só via
-- service_role no backend).
-- ---------------------------------------------------------------------------
create table ml_tokens (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ml_tokens_single_row check (id = 1)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table item_config enable row level security;
alter table items_cache enable row level security;
alter table campaigns_cache enable row level security;
alter table campaign_decisions enable row level security;
alter table ml_tokens enable row level security;

-- App single-tenant: qualquer usuário autenticado (só existe o dono da conta,
-- cadastro público desabilitado no Supabase Auth) tem acesso total às
-- tabelas de negócio. ml_tokens fica sem nenhuma policy — só service_role
-- (usado nas rotas de servidor) consegue ler/gravar.
create policy "authenticated full access" on app_settings
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on item_config
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on items_cache
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on campaigns_cache
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on campaign_decisions
  for all to authenticated using (true) with check (true);
