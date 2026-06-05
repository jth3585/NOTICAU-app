import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const FLAG = 'noticau:migrated';

export async function migrateLocalToDB(): Promise<void> {
  if ((await AsyncStorage.getItem(FLAG)) === 'done') return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return; // 세션 없으면 다음 기회

  const bookmarksRaw = await AsyncStorage.getItem('noticau:bookmarks');
  const readRaw = await AsyncStorage.getItem('noticau:read');
  const bookmarkIds: string[] = bookmarksRaw ? JSON.parse(bookmarksRaw) : [];
  const readIds: string[] = readRaw ? JSON.parse(readRaw) : [];

  const rows = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();

  bookmarkIds.forEach((id) =>
    rows.set(id, { user_id: session.user.id, notice_id: id, bookmarked_at: now }),
  );
  readIds.forEach((id) => {
    const existing = rows.get(id) ?? { user_id: session.user.id, notice_id: id };
    rows.set(id, { ...existing, read_at: now });
  });

  if (rows.size > 0) {
    const { error } = await supabase
      .from('user_feed_state')
      .upsert(Array.from(rows.values()), { onConflict: 'user_id,notice_id' });
    if (error) {
      console.error('[migrate] failed', error.message);
      return; // 플래그 미설정 → 다음 재시도
    }
  }

  await AsyncStorage.setItem(FLAG, 'done');
}
