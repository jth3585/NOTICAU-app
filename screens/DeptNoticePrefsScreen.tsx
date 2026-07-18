import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useProfile, updateProfile } from '../lib/profile';
import { useDisabledSources } from '../lib/sourcePrefs';
import { toast } from '../lib/toast';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';

type SourceRow = { parser_key: string; name: string; owner_unit: string | null; scope_type: string | null; campus: string | null };

// 출처(게시판) 캠퍼스가 내 캠퍼스에 노출되는가 ('both'·미지정 통과, anseong≈davinci)
function campusVisible(sc: string | null | undefined, myCampus: string | null | undefined): boolean {
  if (!sc || sc === 'both' || !myCampus) return true;
  if (sc === myCampus) return true;
  if (sc === 'anseong' && myCampus === 'davinci') return true;
  return false;
}

export default function DeptNoticePrefsScreen() {
  const navigation = useNavigation();
  // edges=['top']이라 하단은 내비바 뒤로 흐름 → 리스트 끝 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const profile = useProfile() as any;
  const { disabled, toggle } = useDisabledSources();

  const [crossDept, setCrossDept] = useState(true);
  const [sources, setSources] = useState<SourceRow[]>([]);

  useEffect(() => {
    setCrossDept(profile?.show_cross_dept ?? true);
  }, [profile?.show_cross_dept]);

  useEffect(() => {
    supabase.from('sources')
      .select('parser_key, name, owner_unit, scope_type, campus')
      .in('scope_type', ['dept', 'college'])
      .not('owner_unit', 'is', null)
      .order('name')
      .then(({ data }) => setSources((data as SourceRow[]) ?? []));
  }, []);

  // 타 학과/타 단대 게시판만(내 소속 제외) + 내 캠퍼스에 노출되는 것만.
  const list = useMemo(() => {
    const mine = new Set([profile?.dept, profile?.dept_secondary, profile?.college].filter(Boolean));
    return sources.filter((s) =>
      s.owner_unit && !mine.has(s.owner_unit) && campusVisible(s.campus, profile?.campus),
    );
  }, [sources, profile?.dept, profile?.dept_secondary, profile?.college, profile?.campus]);

  const toggleCrossDept = async (next: boolean) => {
    setCrossDept(next);
    const { error } = await updateProfile({ show_cross_dept: next } as any);
    if (error) { setCrossDept(!next); toast('설정을 저장하지 못했어요. 다시 시도해 주세요.', 'error'); }
  };

  const onToggleSource = async (parserKey: string, enabled: boolean) => {
    try { await toggle(parserKey, enabled); }
    catch { toast('설정을 저장하지 못했어요. 다시 시도해 주세요.', 'error'); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>학과별 공지설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={crossDept ? list : []}
        keyExtractor={(s) => s.parser_key}
        contentContainerStyle={[styles.listContent, { paddingBottom: SPACING.xxl + insets.bottom }]}
        ListHeaderComponent={
          <View style={styles.crossWrap}>
            <View style={styles.crossRow}>
              <Text style={styles.crossLabel}>타 학과 공지 보기</Text>
              <Switch
                value={crossDept}
                onValueChange={toggleCrossDept}
                trackColor={{ true: COLORS.accent }}
                thumbColor="#fff"
                style={styles.switch}
              />
            </View>
            <Text style={styles.crossSub}>
              내 공지 피드에 다른 학과의 전체대상 공지(채용·세미나·대회 등)를 함께 볼지 정해요.
              학과 한정 공지(학사·장학 등)는 원래 해당 학과 학생에게만 가요.
            </Text>
            {crossDept ? (
              <Text style={styles.listHint}>아래에서 켠 학과의 전체대상 공지만 피드에 들어와요.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowLabel} numberOfLines={1}>{item.name}</Text>
            <Switch
              value={!disabled.has(item.parser_key)}
              onValueChange={(v) => onToggleSource(item.parser_key, v)}
              trackColor={{ true: COLORS.accent }}
              thumbColor="#fff"
              style={styles.switch}
            />
          </View>
        )}
        ListEmptyComponent={
          crossDept ? (
            <Text style={styles.empty}>표시할 다른 학과 게시판이 없어요.</Text>
          ) : (
            <Text style={styles.empty}>‘타 학과 공지 보기’를 켜면 학과별로 켜고 끌 수 있어요.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  listContent: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  crossWrap: { marginBottom: SPACING.lg },
  crossRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    ...SHADOW.card,
  },
  crossLabel: { fontSize: FONT.body, color: COLORS.text },
  crossSub: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.sm, lineHeight: 18 },
  listHint: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.md, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  rowLabel: { fontSize: FONT.body, color: COLORS.text, flexShrink: 1, paddingRight: SPACING.md },
  empty: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACING.xl },
  switch: { transform: [{ scale: 0.8 }] },
});
