-- campaign_decisions cresceu pra 400k+ linhas (sem limpeza entre rodadas) e
-- "ORDER BY created_at DESC LIMIT 1" (getLatestRunId, usado em toda página
-- que mostra a última rodada) não tinha nenhum índice pra usar — forçava
-- varredura + ordenação da tabela inteira, o que chegou a estourar o
-- statement_timeout do Postgres mesmo usando a service_role key (sem RLS).
-- Sem esse índice, a página caía silenciosamente em "nunca rodou nenhuma
-- atualização" (getLatestRunId engolia o erro de timeout sem avisar).
create index concurrently if not exists campaign_decisions_created_at_idx on campaign_decisions (created_at desc);
