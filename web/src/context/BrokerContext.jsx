// Broker elegido para operar (Alpaca o Webull). Se persiste en localStorage y lo usan el ticket, Posiciones y Órdenes.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { brokersApi } from '../api/resources';

const CLAVE = 'opciones.broker.v1';
const POR_DEFECTO = 'alpaca';

// Si GET /brokers/disponibles aún no existe, se ofrecen ambos con estado «sin verificar» (operativo: null).
const RESPALDO = [
  { codigo: 'alpaca', nombre: 'Alpaca', configurado: null, operativo: null, entornos: ['paper'] },
  { codigo: 'webull', nombre: 'Webull', configurado: null, operativo: null, entornos: ['paper'], mensaje: 'Estado no verificado: el servidor aún no informa los brokers disponibles.' },
];

function leer() {
  try { return localStorage.getItem(CLAVE) || POR_DEFECTO; } catch { return POR_DEFECTO; }
}

const BrokerContext = createContext(null);

export function BrokerProvider({ children }) {
  const [broker, setBrokerState] = useState(leer);
  const [estado, setEstado] = useState({ items: RESPALDO, cargando: true, error: null, verificado: false });

  const cargar = useCallback(async () => {
    setEstado(s => ({ ...s, cargando: true }));
    try {
      const r = await brokersApi.disponibles();
      const items = Array.isArray(r?.items) && r.items.length ? r.items : RESPALDO;
      setEstado({ items, cargando: false, error: null, verificado: items !== RESPALDO });
    } catch (error) {
      setEstado({ items: RESPALDO, cargando: false, error, verificado: false });
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const setBroker = useCallback(codigo => {
    setBrokerState(codigo);
    try { localStorage.setItem(CLAVE, codigo); } catch { /* sin almacenamiento */ }
  }, []);

  const value = useMemo(() => {
    const info = estado.items.find(b => b.codigo === broker) || estado.items[0] || null;
    const entorno = info?.entornos?.[0] || 'paper';
    return {
      broker: info?.codigo || broker,
      info,
      nombre: info?.nombre || (broker === 'webull' ? 'Webull' : 'Alpaca'),
      entorno,
      disponibles: estado.items,
      cargando: estado.cargando,
      error: estado.error,
      verificado: estado.verificado,
      // false solo si el servidor dijo explícitamente que no se puede operar con este broker.
      bloqueado: info?.operativo === false,
      setBroker,
      recargar: cargar,
    };
  }, [broker, estado, setBroker, cargar]);

  return <BrokerContext.Provider value={value}>{children}</BrokerContext.Provider>;
}

export function useBroker() {
  const ctx = useContext(BrokerContext);
  if (!ctx) throw new Error('useBroker debe usarse dentro de BrokerProvider.');
  return ctx;
}
