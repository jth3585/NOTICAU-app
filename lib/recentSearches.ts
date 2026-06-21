import AsyncStorage from '@react-native-async-storage/async-storage';

// 최근 검색어 (로컬). 최대 8개, 중복은 맨 앞으로.
const KEY = '@noticau/recentSearches';
const MAX = 8;

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function addRecentSearch(q: string): Promise<string[]> {
  const t = q.trim();
  if (!t) return getRecentSearches();
  const cur = await getRecentSearches();
  const next = [t, ...cur.filter((x) => x !== t)].slice(0, MAX);
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}
