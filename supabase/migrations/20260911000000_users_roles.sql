-- Convite de usuários + papéis (admin / usuario).
--
-- admin: vê e edita tudo (itens, configurações, gestão de usuários,
--   decisões, atualizar, aplicar campanhas).
-- usuario: só atualiza, vê/aprova decisões e aplica campanhas — não edita
--   item_config nem app_settings (nem tem acesso à tela de gestão de
--   usuários, que fica dentro de Configurações).

create table app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'usuario' check (role in ('admin', 'usuario')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SECURITY DEFINER: a policy de app_users abaixo chama esta função pra
-- decidir acesso — se ela não fosse DEFINER, a própria checagem esbarraria
-- na RLS de app_users e resultaria em recursão/sempre-nega.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from app_users where id = auth.uid() and role = 'admin'
  );
$$;

alter table app_users enable row level security;

create policy "self or admin pode ver" on app_users
  for select to authenticated
  using (auth.uid() = id or is_admin());

create policy "admin pode gerenciar" on app_users
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- item_config e app_settings passam a ser só-admin (leitura e escrita) —
-- as rotas de API que já usam service_role (upload de itens, atualizar,
-- aplicar) continuam funcionando normalmente, pois service_role ignora RLS;
-- isso trava o acesso direto do cliente autenticado comum (usuario).
drop policy "authenticated full access" on item_config;
create policy "admin full access" on item_config
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy "authenticated full access" on app_settings;
create policy "admin full access" on app_settings
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Backfill: o usuário criado manualmente antes de existir esta tabela vira
-- admin (é o dono da conta Supabase/Vercel/ML que pediu essa feature).
insert into app_users (id, email, role)
values ('4277e7bb-b383-4d12-b6d2-4d29861cf5ba', 'leonardo.feijo@sobmedidawebshop.com.br', 'admin')
on conflict (id) do nothing;
