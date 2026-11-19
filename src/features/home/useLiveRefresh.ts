import { useFocusEffect } from 'expo-router';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Increments a version counter whenever the screen gains focus, when the SQLite
 * database changes (debounced), or when `refresh()` is called manually.
 */
export function useLiveRefresh(debounceMs = 150): [number, () => void] {
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = addDatabaseChangeListener(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setTick((t) => t + 1);
        }, debounceMs);
      });
    } catch {
      // Fallback gracefully on environments without native change listener
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sub?.remove();
    };
  }, [debounceMs]);

  return [tick, refresh];
}
