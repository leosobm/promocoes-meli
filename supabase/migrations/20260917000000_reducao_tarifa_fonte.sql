-- Distingue redução de tarifa confirmada pela API (discount_meli_boost_amount)
-- de redução ESTIMADA a partir de meli_percentage (com gordura de segurança
-- de 1.5pp) — ver conversa com suporte do Mercado Livre: a API não expõe
-- boosted_offer/discount_meli_boost_amount de forma confiável mesmo em
-- ofertas ativas, mas o painel mostra o valor real desde antes da adesão;
-- meli_percentage aproxima esse valor na maioria dos casos testados
-- (mediana ~1,2% de desvio), então usamos como estimativa conservadora
-- em vez de tratar como zero.
alter table campaign_decisions add column reducao_tarifa_fonte text;
comment on column campaign_decisions.reducao_tarifa_fonte is
  'api_confirmada = veio de discount_meli_boost_amount (valor exato da API). estimada_meli_percentage = calculado a partir de meli_percentage com gordura de 1.5pp de segurança, por falta de confirmação da API. null = sem nenhuma redução detectada.';
