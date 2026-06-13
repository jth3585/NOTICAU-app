import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>카테고리 편집</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.hint}>켜둔 카테고리만 '전체' 피드에 보여요. 왼쪽 손잡이를 끌어 순서를 바꿀 수 있어요.</Text>
      <ReorderableList
        data={order}
        onReorder={onReorder}
        keyExtractor={(t) => t}
        contentContainerStyle={styles.listContent}
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
  hint: { fontSize: FONT.caption, color: COLORS.textSecondary, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  listContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
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
