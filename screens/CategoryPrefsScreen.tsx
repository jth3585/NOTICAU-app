import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Gesture } from 'react-native-gesture-handler';
import ReorderableList, {
  useReorderableDrag, reorderItems, type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { CategoryBadge } from '../components/ui/CategoryBadge';
import { GripIcon } from '../components/ui/icons';
import { orderedCategories, CATEGORIES } from '../lib/categories';

export default function CategoryPrefsScreen() {
  const navigation = useNavigation();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<string[]>(CATEGORIES);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const { data } = await supabase.from('user_category_prefs')
        .select('topic,is_enabled,sort_order').eq('user_id', session.user.id);
      const rows = (data ?? []) as any[];
      const map: Record<string, boolean> = {};
      rows.forEach((r) => { map[r.topic] = r.is_enabled; });
      setPrefs(map);
      setOrder(orderedCategories(rows));
    })();
  }, []);

  const toggle = async (topic: string) => {
    if (!userId) return;
    const next = prefs[topic] === false ? true : false; // default ON
    setPrefs(prev => ({ ...prev, [topic]: next }));
    await supabase.from('user_category_prefs').upsert(
      { user_id: userId, topic, is_enabled: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,topic' },
    );
  };

  const onReorder = async ({ from, to }: ReorderableListReorderEvent) => {
    const next = reorderItems(order, from, to);
    setOrder(next);
    if (!userId) return;
    const now = new Date().toISOString();
    await supabase.from('user_category_prefs').upsert(
      next.map((topic, i) => ({ user_id: userId, topic, sort_order: i, updated_at: now })),
      { onConflict: 'user_id,topic' },
    );
  };

  const isEnabled = (topic: string) => prefs[topic] !== false;

  // 재정렬 팬 제스처를 세로 움직임에만 활성화 → iOS 왼쪽 엣지 스와이프백을 막지 않음.
  // (기본 panGesture는 activeOffset 제약이 없어 가로 스와이프도 가로채 뒤로가기가 안 됨)
  const panGesture = useMemo(() => Gesture.Pan().activeOffsetY([-10, 10]), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>전체공지 관리</Text>
        <View style={{ width: 40 }} />
      </View>
      <ReorderableList
        data={order}
        onReorder={onReorder}
        panGesture={panGesture}
        keyExtractor={(t) => t}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          <Text style={styles.hint}>켜둔 카테고리만 '전체' 피드에 보여요. 왼쪽 손잡이를 끌어 순서를 바꿀 수 있어요.</Text>
        }
        renderItem={({ item }) => (
          <CategoryRow topic={item} enabled={isEnabled(item)} onToggle={() => toggle(item)} />
        )}
      />
    </SafeAreaView>
  );
}

function CategoryRow({ topic, enabled, onToggle }: { topic: string; enabled: boolean; onToggle: () => void }) {
  const drag = useReorderableDrag();
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <TouchableOpacity onLongPress={drag} delayLongPress={120} hitSlop={10} style={styles.grip} activeOpacity={0.6}>
          <GripIcon size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
        <CategoryBadge topic={topic} size="md" />
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        trackColor={{ true: COLORS.accent }}
        thumbColor="#fff"
        style={styles.switch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  hint: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.md, lineHeight: 18 },
  listContent: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.xxl },
  // 타 학과 공지 보기 토글 (목록 상단 헤더 카드 + 아래 세부설명 힌트)
  crossWrap: { marginBottom: SPACING.lg },
  crossRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    ...SHADOW.card,
  },
  crossLabel: { fontSize: FONT.body, color: COLORS.text },
  crossSub: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.sm, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  grip: { padding: 2 },
  switch: { transform: [{ scale: 0.8 }] },
});
