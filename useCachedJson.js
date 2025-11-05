// useCachedJson.js
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function useCachedJson({ url, cacheKey, ttlMs = 3600_000, enabled = true }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ok' | 'error'
  const [error, setError] = useState(null);
  const ctrlRef = useRef(null);

  useEffect(() => {
    if (!enabled || !url || !cacheKey) return;

    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError(null);

      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.savedAt && Date.now() - parsed.savedAt < ttlMs && parsed?.payload) {
            if (!cancelled) {
              setData(parsed.payload);
              setStatus('ok');
            }
            return;
          }
        }

        if (ctrlRef.current) ctrlRef.current.abort();
        ctrlRef.current = new AbortController();
        const res = await fetch(url, { signal: ctrlRef.current.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!cancelled) {
          setData(json);
          setStatus('ok');
        }

        await AsyncStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload: json }));
      } catch (e) {
        if (cancelled) return;
        // Fallback to stale cache if available
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.payload) {
              setData(parsed.payload);
              setStatus('ok');
              setError(e);
              return;
            }
          }
        } catch {}
        setError(e);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (ctrlRef.current) ctrlRef.current.abort();
    };
  }, [url, cacheKey, ttlMs, enabled]);

  return { data, status, error, refresh: () => AsyncStorage.removeItem(cacheKey) };
}
