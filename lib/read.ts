import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'noticau:read';

export async function readReadIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function markAsRead(noticeId: string): Promise<void> {
  try {
    const set = await readReadIds();
    if (!set.has(noticeId)) {
      set.add(noticeId);
      await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
    }
  } catch {}
}

export function useReadSet() {
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const set = await readReadIds();
    if (mountedRef.current) setReadSet(new Set(set));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const isRead = useCallback((id: string) => readSet.has(id), [readSet]);

  return { readSet, refresh, isRead };
}
