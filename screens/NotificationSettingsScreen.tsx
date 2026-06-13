import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const { data } = await supabase.from('profiles')
        .select('notifications_enabled').eq('user_id', session.user.id).maybeSingle();
      if (data) setEnabled((data as any).notifications_enabled !== false);
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>알림 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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

        <Text style={styles.note}>· 켜 두면 매일 오전 8시에 새 공지 요약을 받아요.</Text>
        <Text style={styles.note}>· 키워드 즉시 알림은 키워드 관리에서 키워드별로 설정해요.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  back: { fontSize: FONT.body, color: COLORS.text },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl, paddingTop: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.card, overflow: 'hidden', marginBottom: SPACING.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  rowLabel: { fontSize: FONT.body, color: COLORS.text },
  note: { fontSize: FONT.caption, color: COLORS.textSecondary, marginBottom: SPACING.xs, lineHeight: 18 },
});
