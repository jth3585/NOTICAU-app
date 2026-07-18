import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';

type Kw = { id: string; keyword: string; notify: boolean };

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  // edges=['top']이라 하단은 내비바 뒤로 흐름 → 스크롤 끝 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [keywords, setKeywords] = useState<Kw[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const [profRes, kwRes] = await Promise.all([
        supabase.from('profiles').select('notifications_enabled').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('user_keywords').select('id,keyword,notify').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      ]);
      if (profRes.data) setEnabled((profRes.data as any).notifications_enabled !== false);
      setKeywords((kwRes.data as Kw[]) ?? []);
      setLoaded(true);
    })();
  }, []);

  const toggle = async () => {
    if (!userId) return;
    const next = !enabled;
    setEnabled(next);
    await supabase.from('profiles')
      .update({ notifications_enabled: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  };

  const toggleKeyword = async (id: string, next: boolean) => {
    setKeywords(prev => prev.map(k => (k.id === id ? { ...k, notify: next } : k)));
    await supabase.from('user_keywords').update({ notify: next }).eq('id', id);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>알림 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: SPACING.xxl + insets.bottom }]}>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>알림 받기</Text>
            <Switch
              value={enabled}
              onValueChange={toggle}
              disabled={!loaded}
              trackColor={{ true: COLORS.accent }}
              thumbColor="#fff"
              style={{ transform: [{ scale: 0.75 }] }}
            />
          </View>
        </View>
        <Text style={styles.note}>· 켜 두면 매일 저녁 6시에 그날 올라온 새 공지 건수를 알려드려요.</Text>

        {/* 키워드별 즉시 알림 */}
        <Text style={styles.groupLabel}>키워드 알림</Text>
        <View style={styles.card}>
          {keywords.length === 0 ? (
            <Text style={styles.empty}>등록한 키워드가 없어요. ‘키워드 관리’에서 추가해 보세요.</Text>
          ) : (
            keywords.map((k, i) => (
              <View key={k.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <Text style={[styles.rowLabel, !enabled && styles.rowLabelDim]} numberOfLines={1}>{k.keyword}</Text>
                <Switch
                  value={k.notify}
                  onValueChange={(v) => toggleKeyword(k.id, v)}
                  disabled={!loaded || !enabled}
                  trackColor={{ true: COLORS.accent }}
                  thumbColor="#fff"
                  style={{ transform: [{ scale: 0.75 }] }}
                />
              </View>
            ))
          )}
        </View>
        <Text style={styles.note}>· 켠 키워드가 포함된 새 공지가 올라오면 바로 알려드려요.</Text>
        <Text style={styles.note}>· 키워드 추가·삭제는 ‘키워드 관리’에서 할 수 있어요.</Text>
        {!enabled && keywords.length > 0 ? (
          <Text style={styles.note}>· ‘알림 받기’를 켜야 키워드 알림도 받을 수 있어요.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  scroll: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.card, overflow: 'hidden', marginBottom: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  rowLabel: { fontSize: FONT.body, color: COLORS.text, flex: 1, paddingRight: SPACING.md },
  rowLabelDim: { color: COLORS.textTertiary },
  groupLabel: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold, marginTop: SPACING.lg, marginBottom: SPACING.sm, marginLeft: SPACING.xs },
  note: { fontSize: FONT.caption, color: COLORS.textSecondary, marginBottom: SPACING.xs, lineHeight: 18 },
  empty: { fontSize: FONT.caption, color: COLORS.textSecondary, padding: SPACING.lg },
});
