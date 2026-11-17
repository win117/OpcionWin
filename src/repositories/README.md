# Acceso a datos

Esta capa separará los servicios del motor de persistencia.

- `mongodb/`: implementaciones para MongoDB.
- `supabase/`: implementaciones para Supabase.

La selección se resolverá por sesión autenticada, no cambiando una variable global para todos los usuarios. Las dos implementaciones deberán cumplir el mismo contrato de operaciones. No hay conexiones nuevas ni repositorios funcionales en el inciso B.

