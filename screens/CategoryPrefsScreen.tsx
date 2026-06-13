import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { CategoryBadge } from '../components/ui/CategoryBadge';
import { ChevronUpIcon, ChevronDownIcon } from '../components/ui/icons';
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

  // 위/아래로 한 칸 이동 + 전체 순서(sort_order) 저장
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
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
      <Text style={styles.hint}>켜둔 카테고리만 '전체' 피드에 보여요. 화살표로 순서를 바꿀 수 있어요.</Text>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          {order.map((topic, i) => (
            <View key={topic} style={[styles.row, i < order.length - 1 && styles.rowBorder]}>
              <CategoryBadge topic={topic} size="md" />
              <View style={styles.rowRight}>
                <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={styles.arrow}>
                  <ChevronUpIcon size={20} color={i === 0 ? COLORS.border : COLORS.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => move(i, 1)} disabled={i === order.length - 1} hitSlop={6} style={styles.arrow}>
                  <ChevronDownIcon size={20} color={i === order.length - 1 ? COLORS.border : COLORS.textSecondary} />
                </TouchableOpacity>
                <Switch
                  value={isEnabled(topic)}
                  onValueChange={() => toggle(topic)}
                  trackColor={{ true: COLORS.accent }}
                  thumbColor="#fff"
                  style={styles.switch}
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  hint: { fontSize: FONT.caption, color: COLORS.textSecondary, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 4 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  arrow: { padding: 2 },
  switch: { transform: [{ scale: 0.8 }], marginLeft: SPACING.xs },
});
