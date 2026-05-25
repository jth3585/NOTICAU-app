import { useEffect, useState, type ReactNode } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './lib/supabase';
import type { Notice, NoticeMeta, Source } from './lib/types';

// PostgREST 임베드가 객체/배열 어느 쪽으로 와도 단일 값으로 정규화.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const meta = (n: Notice): NoticeMeta | null => one(n.notice_meta);
const src = (n: Notice): Source | null => one(n.sources);

// 정렬: deadline_at(asc, NULLS LAST) → posted_at(desc).
// 과거 마감 항목도 필터링하지 않고 그대로 노출 (이번 세션은 raw 확인 목적).
// Array.prototype.sort는 ES2019+ 안정 정렬.
function sortNotices(rows: Notice[]): Notice[] {
  return [...rows].sort((a, b) => {
    const da = meta(a)?.deadline_at ?? null;
    const db = meta(b)?.deadline_at ?? null;
    if (da !== db) {
      if (da === null) return 1; // null은 뒤로
      if (db === null) return -1;
      const cmp = da.localeCompare(db); // ISO 문자열 = 시간 오름차순
      if (cmp !== 0) return cmp;
    }
    const pa = a.posted_at ?? '';
    const pb = b.posted_at ?? '';
    return pb.localeCompare(pa); // posted_at 내림차순
  });
}

export default function App() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('notices')
        .select('*, notice_meta(*), sources(parser_key, name)')
        .order('posted_at', { ascending: false })
        .limit(100);

      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setNotices(sortNotices((data ?? []) as Notice[]));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Centered>Loading...</Centered>;
  if (error) return <Centered>Error: {error}</Centered>;
  if (notices.length === 0) return <Centered>No notices</Centered>;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NoticeCard notice={item} />}
      />
    </SafeAreaView>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  const m = meta(notice);
  const s = src(notice);
  return (
    <View style={styles.card}>
      <Text>title: {notice.title}</Text>
      <Text>parser_key: {s?.parser_key ?? '(null)'}</Text>
      <Text>source name: {s?.name ?? '(null)'}</Text>
      <Text>source_category: {notice.source_category ?? '(null)'}</Text>
      <Text>posted_at: {notice.posted_at ?? '(null)'}</Text>
      <Text>deadline_at: {m?.deadline_at ?? '(null)'}</Text>
      <Text>topic: {m?.topic ?? '(null)'}</Text>
      <Text>action: {m?.action ?? '(null)'}</Text>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={styles.centered}>
      <StatusBar style="auto" />
      <Text>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { paddingHorizontal: 16, paddingVertical: 12 },
});
