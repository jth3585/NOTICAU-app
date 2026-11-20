import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Device from 'expo-device';
import { supabase } from '../lib/supabase';
import {
  getPushPermission, openDeviceNotificationSettings, requestPushPermission, setupPushNotifications, type PushPermission,
} from '../lib/push';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { toast } from '../lib/toast';

type Kw = { id: string; keyword: string; notify: boolean };

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  // edges=['top']이라 하단은 내비바 뒤로 흐름 → 스크롤 끝 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  // 내 학과 새 행사 알림. 서버는 true 인 사람에게만 보낸다(값이 없으면 앱 첫 실행 때 켜진다).
  const [eventAlerts, setEventAlerts] = useState(true);
  const [keywords, setKeywords] = useState<Kw[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 기기(OS) 알림 권한. 꺼져 있으면 아래 스위치와 상관없이 푸시가 오지 않으니 위에 따로 알려 준다.
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const wasGranted = useRef<boolean | null>(null);

  const refreshPerm = useCallback(async () => {
    if (!Device.isDevice) return;
    const p = await getPushPermission().catch(() => null);
    if (!p) return;
    // 기기 설정에서 방금 켜고 돌아온 경우 토큰을 바로 저장한다(다음 실행까지 기다리지 않게).
    if (p.granted && wasGranted.current === false) setupPushNotifications();
    wasGranted.current = p.granted;
    setPerm(p);
  }, []);

  useFocusEffect(useCallback(() => { refreshPerm(); }, [refreshPerm]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshPerm(); });
    return () => sub.remove();
  }, [refreshPerm]);

  // 아직 물을 수 있으면 시스템 권한 창, 이미 거절해서 못 물으면 기기 설정 화면으로.
  const turnOnDeviceNotifications = async () => {
    if (!perm?.canAskAgain) { openDeviceNotificationSettings(); return; }
    const next = await requestPushPermission().catch(() => null);
    if (!next) return;
    if (next.granted) setupPushNotifications();
    wasGranted.current = next.granted;
    setPerm(next);
  };
  const deviceOff = !!perm && !perm.granted;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const [profRes, kwRes] = await Promise.all([
        supabase.from('profiles').select('notifications_enabled, event_alerts_enabled').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('user_keywords').select('id,keyword,notify').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      ]);
      if (profRes.data) {
        setEnabled((profRes.data as any).notifications_enabled !== false);
        setEventAlerts((profRes.data as any).event_alerts_enabled !== false);
      }
      setKeywords((kwRes.data as Kw[]) ?? []);
      setLoaded(true);
    })();
  }, []);

  // 저장에 실패하면 스위치를 되돌리고 알린다(저장 안 됐는데 꺼진 것처럼 보이면 푸시가 계속 온다).
  const SAVE_FAIL = '설정을 저장하지 못했어요. 다시 시도해 주세요.';

  const toggle = async () => {
    if (!userId) return;
    const next = !enabled;
    setEnabled(next);
    const { error } = await supabase.from('profiles')
      .update({ notifications_enabled: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { setEnabled(!next); toast(SAVE_FAIL, 'error'); }
  };

  const toggleEventAlerts = async () => {
    if (!userId) return;
    const next = !eventAlerts;
    setEventAlerts(next);
    const { error } = await supabase.from('profiles')
      .update({ event_alerts_enabled: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { setEventAlerts(!next); toast(SAVE_FAIL, 'error'); }
  };

  const toggleKeyword = async (id: string, next: boolean) => {
    setKeywords(prev => prev.map(k => (k.id === id ? { ...k, notify: next } : k)));
    const { error } = await supabase.from('user_keywords').update({ notify: next }).eq('id', id);
    if (error) {
      setKeywords(prev => prev.map(k => (k.id === id ? { ...k, notify: !next } : k)));
      toast(SAVE_FAIL, 'error');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>알림 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: SPACING.xxl + insets.bottom }]}>
        {deviceOff ? (
          <View style={styles.deviceCard}>
            <Text style={styles.deviceTitle}>기기 알림이 꺼져 있어요</Text>
            <Text style={styles.deviceDesc}>지금은 알림이 알림함에만 쌓이고 푸시로는 오지 않아요.</Text>
            <TouchableOpacity style={styles.deviceBtn} onPress={turnOnDeviceNotifications} activeOpacity={0.75} accessibilityRole="button">
              <Text style={styles.deviceBtnText}>{perm?.canAskAgain ? '알림 허용하기' : '기기 설정에서 켜기'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
        <Text style={styles.note}>· 켜 두면 매일 저녁 6시에 그날 올라온 내 공지를 모아 알려드려요.</Text>

        {/* 내 학과 새 행사 */}
        <Text style={styles.groupLabel}>행사 알림</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>내 학과 새 행사</Text>
            <Switch
              value={eventAlerts}
              onValueChange={toggleEventAlerts}
              disabled={!loaded}
              trackColor={{ true: COLORS.accent }}
              thumbColor="#fff"
              style={{ transform: [{ scale: 0.75 }] }}
            />
          </View>
        </View>
        <Text style={styles.note}>· 내 학과·단과대 행사가 새로 올라오면 알려드려요.</Text>
        {!enabled && eventAlerts ? (
          <Text style={styles.note}>· ‘알림 받기’가 꺼져 있으면 푸시 없이 알림함에만 쌓여요.</Text>
        ) : null}

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
  deviceCard: { backgroundColor: COLORS.accentSoft, borderRadius: RADIUS.card, padding: SPACING.lg, marginBottom: SPACING.lg },
  deviceTitle: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: COLORS.text, marginBottom: SPACING.xs },
  deviceDesc: { fontSize: FONT.caption, color: COLORS.textSecondary, lineHeight: 18, marginBottom: SPACING.md },
  deviceBtn: { alignSelf: 'flex-start', backgroundColor: COLORS.accent, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  deviceBtnText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: '#fff' },
});
