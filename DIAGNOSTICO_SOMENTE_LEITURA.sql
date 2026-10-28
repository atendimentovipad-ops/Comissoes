-- DIAGNÓSTICO SOMENTE DE LEITURA: não cria, altera ou apaga registros.
-- Execute no SQL Editor do banco do MESMO projeto Lovable Cloud.
select
  to_regclass('public.pricing_shared_state') as tabela_base,
  to_regclass('public.pricing_comparison_state') as tabela_comparativo,
  to_regprocedure('public.publish_pricing_report(uuid,uuid,text,integer,uuid)') as funcao_publicar_base,
  to_regprocedure('public.publish_pricing_comparison(text,text,uuid,uuid,text,integer,uuid)') as funcao_publicar_comparativo;

select id, public as bucket_publico
from storage.buckets where id = 'pricing-reports';

select case when to_regclass('public.pricing_shared_state') is not null
  then has_table_privilege('service_role', 'public.pricing_shared_state', 'SELECT')
  else null end as service_role_pode_ler_base;
