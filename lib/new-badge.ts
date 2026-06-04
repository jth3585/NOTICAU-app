import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'noticau:last_seen_at';

export async function getLastSeenAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function touchLastSeenAt(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, new Date().toISOString());
  } catch {}
}

export function useLastSeenAt() {
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    getLastSeenAt().then((v) => {
      if (mountedRef.current) setLastSeenAt(v);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const touch = useCallback(async () => {
    await touchLastSeenAt();
    setLastSeenAt(new Date().toISOString());
  }, []);

  return { lastSeenAt, touch };
}
