import { useFocusEffect } from 'expo-router';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

/**
 * Increments a revision counter whenever any of the watched SQLite tables change
 * or when the screen regains focus. Lightweight multi-table reactivity.
 */
export function useTableRevision(tables: readonly string[]): {
  rev: number;
  refresh: () => void;
} {
  const [rev, setRev] = useState(0);
  const key = tables.join(',');

  const refresh = useCallback(() => {
    setRev((r) => r + 1);
  }, []);

  useEffect(() => {
    const watched = new Set(key.split(',').filter(Boolean));
    const sub = addDatabaseChangeListener((event) => {
      if (watched.has(event.tableName)) {
        setRev((r) => r + 1);
      }
    });
    return () => {
      sub.remove();
    };
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      setRev((r) => r + 1);
    }, []),
  );

  return { rev, refresh };
}
