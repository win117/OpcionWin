import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export const TERMINAL = ['completada', 'fallida'];
export const isTerminal = estado => TERMINAL.includes(estado);

/**
 * Sondea un trabajo asíncrono (202 + GET) cada `interval` ms hasta completada|fallida.
 * Se detiene tras `timeout` ms (5 min por defecto) o ante un error 4xx.
 */
export function useJob(pollUrl, { initial = null, interval = 1500, timeout = 5 * 60 * 1000 } = {}) {
  const [state, setState] = useState({ data: initial, error: null, timedOut: false, stopped: false });
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!pollUrl) return undefined;
    let cancelled = false;
    let timer;
    const started = Date.now();
    const first = initialRef.current;
    setState({ data: first, error: null, timedOut: false, stopped: false });
    if (first && isTerminal(first.estado)) return undefined;

    const tick = async () => {
      try {
        const data = await api.get(pollUrl);
        if (cancelled) return;
        setState(s => ({ ...s, data, error: null }));
        if (isTerminal(data?.estado)) return;
      } catch (error) {
        if (cancelled) return;
        const fatal = error.status >= 400 && error.status < 500;
        setState(s => ({ ...s, error, stopped: fatal }));
        if (fatal) return;
      }
      if (Date.now() - started >= timeout) {
        setState(s => ({ ...s, timedOut: true }));
        return;
      }
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, first ? interval : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pollUrl, interval, timeout]);

  const estado = state.data?.estado;
  const done = isTerminal(estado);
  return { ...state, estado, done, running: Boolean(pollUrl) && !done && !state.timedOut && !state.stopped };
}

/**
 * Lanza un trabajo (POST → 202) y sondea su estado.
 * launchFn(...args) devuelve el registro creado; pathFn(registro) da la URL de consulta.
 */
export function useLaunchJob(launchFn, pathFn, options) {
  const [launch, setLaunch] = useState({ url: null, initial: null, error: null, launching: false });
  const job = useJob(launch.url, { ...options, initial: launch.initial });
  const fns = useRef({ launchFn, pathFn });
  fns.current = { launchFn, pathFn };

  const start = useCallback(async (...args) => {
    setLaunch({ url: null, initial: null, error: null, launching: true });
    try {
      const record = await fns.current.launchFn(...args);
      if (!record?._id) throw new Error('El servidor no devolvió el identificador del trabajo.');
      setLaunch({ url: fns.current.pathFn(record), initial: record, error: null, launching: false });
      return record;
    } catch (error) {
      setLaunch({ url: null, initial: null, error, launching: false });
      return null;
    }
  }, []);

  const reset = useCallback(() => setLaunch({ url: null, initial: null, error: null, launching: false }), []);
  return {
    ...job,
    launch: start,
    reset,
    launchError: launch.error,
    launching: launch.launching,
    busy: launch.launching || job.running,
    started: Boolean(launch.url),
  };
}
