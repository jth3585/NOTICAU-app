import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { CategoryBadge } from '../components/ui/CategoryBadge';
import { CHIP_TOPICS } from '../lib/constants';

const CATEGORIES = CHIP_TOPICS.filter(t => t !== '전체') as string[];

export default function CategoryPrefsScreen() {
  const navigation = useNavigation();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const { data } = await supabase.from('user_category_prefs')
        .select('topic,is_enabled').eq('user_id', session.user.id);
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => { map[r.topic] = r.is_enabled; });
      setPrefs(map);
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

  const isEnabled = (topic: string) => prefs[topic] !== false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>카테고리 필터</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.hint}>OFF 카테고리는 '전체' 피드에 표시되지 않습니다.</Text>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          {CATEGORIES.map((topic, i) => (
            <View key={topic} style={[styles.row, i < CATEGORIES.length - 1 && styles.rowBorder]}>
              <CategoryBadge topic={topic} />
              <Switch
                value={isEnabled(topic)}
                onValueChange={() => toggle(topic)}
                trackColor={{ true: COLORS.accent }}
                thumbColor="#fff"
              />
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
  back: { fontSize: FONT.body, color: COLORS.text },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  hint: { fontSize: FONT.caption, color: COLORS.textSecondary, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
});
