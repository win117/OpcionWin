import { useMemo } from 'react';
import { mercado } from '../api/resources';
import { toCandles } from '../pages/mercado/GraficoTab';
import { useAsync } from './useAsync';

/** Velas diarias almacenadas de un símbolo (ascendentes, sin duplicados). `version` fuerza la recarga. */
export function useVelas(simbolo, version = 0) {
  const state = useAsync(async () => toCandles((await mercado.historicos(simbolo, { limit: 10000 })).items || []), [simbolo, version], { enabled: !!simbolo });
  const diarias = useMemo(() => state.data || [], [state.data]);
  return { diarias, loading: state.loading, error: state.error, reload: state.reload, cargado: state.data !== undefined };
}
