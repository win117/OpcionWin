-- Instalación local preparada; ejecutar en el proyecto Supabase elegido.
-- Tablas privadas para el backend Express. No expone datos a anon/authenticated.
BEGIN;
CREATE TABLE IF NOT EXISTS public.api_empresas (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_empresas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_empresas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_empresas TO service_role;
CREATE INDEX IF NOT EXISTS api_empresas_owner ON public.api_empresas(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_estrategias (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_estrategias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_estrategias FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_estrategias TO service_role;
CREATE INDEX IF NOT EXISTS api_estrategias_owner ON public.api_estrategias(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_configuraciones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_configuraciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_configuraciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_configuraciones TO service_role;
CREATE INDEX IF NOT EXISTS api_configuraciones_owner ON public.api_configuraciones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_perfiles_analisis (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_perfiles_analisis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_perfiles_analisis FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_perfiles_analisis TO service_role;
CREATE INDEX IF NOT EXISTS api_perfiles_analisis_owner ON public.api_perfiles_analisis(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_brokers (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_brokers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_brokers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_brokers TO service_role;
CREATE INDEX IF NOT EXISTS api_brokers_owner ON public.api_brokers(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_conexiones_broker (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_conexiones_broker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_conexiones_broker FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_conexiones_broker TO service_role;
CREATE INDEX IF NOT EXISTS api_conexiones_broker_owner ON public.api_conexiones_broker(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_sesiones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_sesiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_sesiones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_sesiones TO service_role;
CREATE INDEX IF NOT EXISTS api_sesiones_owner ON public.api_sesiones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_contratos (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_contratos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_contratos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_contratos TO service_role;
CREATE INDEX IF NOT EXISTS api_contratos_owner ON public.api_contratos(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_datos_mercado (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_datos_mercado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_datos_mercado FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_datos_mercado TO service_role;
CREATE INDEX IF NOT EXISTS api_datos_mercado_owner ON public.api_datos_mercado(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_fundamentales (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_fundamentales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_fundamentales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_fundamentales TO service_role;
CREATE INDEX IF NOT EXISTS api_fundamentales_owner ON public.api_fundamentales(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_institucional (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_institucional ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_institucional FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_institucional TO service_role;
CREATE INDEX IF NOT EXISTS api_institucional_owner ON public.api_institucional(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_noticias (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_noticias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_noticias FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_noticias TO service_role;
CREATE INDEX IF NOT EXISTS api_noticias_owner ON public.api_noticias(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_evaluaciones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_evaluaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_evaluaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_evaluaciones TO service_role;
CREATE INDEX IF NOT EXISTS api_evaluaciones_owner ON public.api_evaluaciones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_selecciones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_selecciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_selecciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_selecciones TO service_role;
CREATE INDEX IF NOT EXISTS api_selecciones_owner ON public.api_selecciones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_confluencias (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_confluencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_confluencias FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_confluencias TO service_role;
CREATE INDEX IF NOT EXISTS api_confluencias_owner ON public.api_confluencias(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_ordenes (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_ordenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_ordenes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_ordenes TO service_role;
CREATE INDEX IF NOT EXISTS api_ordenes_owner ON public.api_ordenes(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_posiciones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_posiciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_posiciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_posiciones TO service_role;
CREATE INDEX IF NOT EXISTS api_posiciones_owner ON public.api_posiciones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_sincronizaciones (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_sincronizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_sincronizaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_sincronizaciones TO service_role;
CREATE INDEX IF NOT EXISTS api_sincronizaciones_owner ON public.api_sincronizaciones(owner_id, id);
CREATE TABLE IF NOT EXISTS public.api_auditoria (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (document ? '_id' AND document->>'_id' = id)
);
ALTER TABLE public.api_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_auditoria TO service_role;
CREATE INDEX IF NOT EXISTS api_auditoria_owner ON public.api_auditoria(owner_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS api_empresas_natural ON public.api_empresas(owner_id, (document->>'simbolo'), (document->>'mercado'));
CREATE UNIQUE INDEX IF NOT EXISTS api_estrategias_natural ON public.api_estrategias(owner_id, (document->>'codigo'));
CREATE UNIQUE INDEX IF NOT EXISTS api_brokers_natural ON public.api_brokers(owner_id, (document->>'codigo'));
CREATE UNIQUE INDEX IF NOT EXISTS api_contratos_natural ON public.api_contratos(owner_id, (document->>'proveedor'), (document->>'contratoExternoId'));
CREATE UNIQUE INDEX IF NOT EXISTS api_noticias_natural ON public.api_noticias(owner_id, (document->>'proveedor'), (document->>'noticiaExternaId'));
CREATE UNIQUE INDEX IF NOT EXISTS api_ordenes_natural ON public.api_ordenes(owner_id, (document->>'conexionId'), (document->>'idempotencyKey'));
CREATE UNIQUE INDEX IF NOT EXISTS api_posiciones_natural ON public.api_posiciones(owner_id, (document->>'conexionId'), (document->>'posicionExternaId'));
CREATE UNIQUE INDEX IF NOT EXISTS api_sesiones_natural ON public.api_sesiones(owner_id, (document->>'tokenHash'));
COMMIT;
