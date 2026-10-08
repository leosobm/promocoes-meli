-- Adiciona a curva "Lançamento" (item novo, sem histórico de vendas pra
-- classificar numa curva ABC ainda) às opções existentes (A, B, C, D).
alter table item_config drop constraint item_config_curva_check;
alter table item_config add constraint item_config_curva_check
  check (curva is null or curva in ('A', 'B', 'C', 'D', 'Lançamento'));

alter table curva_settings drop constraint curva_settings_curva_check;
alter table curva_settings add constraint curva_settings_curva_check
  check (curva in ('A', 'B', 'C', 'D', 'Lançamento'));

insert into curva_settings (curva) values ('Lançamento');
