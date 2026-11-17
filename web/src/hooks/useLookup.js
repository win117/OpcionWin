import { useMemo } from 'react';
import { listAll } from '../api/resources';
import { byId } from '../utils/objects';
import { useAsync } from './useAsync';

/** Carga todos los registros de un recurso para selects y resolución de nombres. */
export function useLookup(resourceApi, params = {}, { enabled = true } = {}) {
  const key = JSON.stringify(params);
  const state = useAsync(() => listAll(resourceApi, params), [resourceApi, key], { enabled });
  const items = useMemo(() => state.data?.items || [], [state.data]);
  const map = useMemo(() => byId(items), [items]);
  return { items, byId: map, loading: state.loading, error: state.error, reload: state.reload };
}
