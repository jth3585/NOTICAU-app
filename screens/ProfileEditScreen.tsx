import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { loadProfile, updateProfile } from '../lib/profile';
import { toast } from '../lib/toast';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { CAMPUS_LABEL, CAMPUS_OPTIONS, STATUS_LABEL, STATUS_OPTIONS } from '../lib/constants';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/ui/icons';
import { FolderNameModal } from '../components/FolderNameModal';
import { BackButton } from '../components/ui/BackButton';

const NICKNAME_MAX = 10;

type Profile = {
  grade: number;
  campus: string;
  college: string | null;
  dept: string | null;
  dept_secondary: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
  nickname: string | null;
};
type Row = { code: string; name: string };


export default function ProfileEditScreen() {
  const navigation = useNavigation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [colleges, setColleges] = useState<Row[]>([]);
  const [allColleges, setAllColleges] = useState<Row[]>([]);
  const [depts, setDepts] = useState<Row[]>([]);
  const [secondaryDepts, setSecondaryDepts] = useState<Row[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [nickOpen, setNickOpen] = useState(false);
  const [secondaryCollegeCode, setSecondaryCollegeCode] = useState<string | null>(null);
  const [secondaryDeptName, setSecondaryDeptName] = useState<string>('');

  // Load profile (공유 스토어 경유 → 캐시 워밍) + all colleges
  const [loadFailed, setLoadFailed] = useState(false);
  const loadAll = useCallback(() => {
    setLoadFailed(false);
    loadProfile()
      .then((p) => { p ? setProfile(p as Profile) : setLoadFailed(true); })
      .catch(() => setLoadFailed(true));
    supabase.from('colleges').select('code,name').order('name').then(({ data }) => setAllColleges((data as Row[]) ?? []));
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  // Load colleges when campus changes
  useEffect(() => {
    if (!profile?.campus) return;
    const campusDb = profile.campus === 'davinci' ? 'anseong' : profile.campus;
    supabase.from('colleges').select('code,name').eq('campus', campusDb).order('name')
      .then(({ data }) => setColleges((data as Row[]) ?? []));
  }, [profile?.campus]);

  // Load main depts when college changes
  useEffect(() => {
    if (!profile?.college) { setDepts([]); return; }
    supabase.from('departments').select('code,name').eq('college_code', profile.college).order('name')
      .then(({ data }) => setDepts((data as Row[]) ?? []));
  }, [profile?.college]);

  // Load secondary depts when secondary college selected
  useEffect(() => {
    if (!secondaryCollegeCode) { setSecondaryDepts([]); return; }
    supabase.from('departments').select('code,name').eq('college_code', secondaryCollegeCode).order('name')
      .then(({ data }) => setSecondaryDepts((data as Row[]) ?? []));
  }, [secondaryCollegeCode]);

  // Load secondary dept display name when profile loads
  useEffect(() => {
    if (!profile?.dept_secondary) { setSecondaryDeptName(''); return; }
    supabase.from('departments').select('name').eq('code', profile.dept_secondary).maybeSingle()
      .then(({ data }) => setSecondaryDeptName((data as any)?.name ?? profile.dept_secondary ?? ''));
  }, [profile?.dept_secondary]);

  // 선택 즉시 로컬 state 갱신 + 공유 스토어 경유 저장(낙관적 브로드캐스트 → 전 화면 즉시 반영).
  // 저장 실패 시 토스트로 알림(이전엔 fire-and-forget이라 조용히 누락됐음).
  const autosave = (p: Partial<Profile>) => {
    setProfile((prev) => prev ? { ...prev, ...p } : prev);
    updateProfile(p).then(({ error }) => {
      if (error) toast('변경 사항을 저장하지 못했어요. 다시 시도해 주세요.', 'error');
    });
  };

  const nameOf = (list: Row[], code: string | null | undefined) =>
    list.find(r => r.code === code)?.name ?? code ?? '—';

  const statusText = (profile?.enrollment_status ?? []).map(s => STATUS_LABEL[s]).join(', ') || '—';

  if (!profile) return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
      </View>
      {loadFailed ? (
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary }}>프로필을 불러오지 못했어요.</Text>
          <TouchableOpacity onPress={loadAll} accessibilityRole="button">
            <Text style={{ color: COLORS.accent, fontWeight: WEIGHT.semibold }}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ color: COLORS.textSecondary, padding: SPACING.lg }}>불러오는 중…</Text>
      )}
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>프로필 수정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Group label="기본 정보">
          <Row_ label="호칭" value={profile.nickname || '미설정'} onPress={() => setNickOpen(true)} />
          <Row_ label="학년" value={`${profile.grade}학년`} onPress={() => setSheet('grade')} />
          <Row_ label="캠퍼스" value={CAMPUS_LABEL[profile.campus] ?? profile.campus} onPress={() => setSheet('campus')} />
        </Group>
        <Group label="소속">
          <Row_ label="단과대학" value={nameOf(colleges, profile.college)} onPress={() => setSheet('college')} />
          <Row_ label="학과" value={nameOf(depts, profile.dept) || (depts.length === 0 && profile.college ? '준비 중' : '—')} onPress={() => depts.length > 0 && setSheet('dept')} />
          <Row_ label="복수전공" value={secondaryDeptName || '없음'} onPress={() => { setSecondaryCollegeCode(null); setSheet('secondary'); }} />
        </Group>
        <Group label="상태">
          <Row_ label="재학상태" value={statusText} onPress={() => setSheet('status')} />
          <Row_ label="기숙사" value={profile.is_dormitory ? '예' : '아니요'} onPress={() => setSheet('dorm')} />
        </Group>
      </ScrollView>

      <FolderNameModal
        visible={nickOpen}
        title="어떻게 불러드릴까요?"
        initialValue={profile.nickname ?? ''}
        placeholder={`호칭 (최대 ${NICKNAME_MAX}자)`}
        maxLength={NICKNAME_MAX}
        allowEmpty
        submitLabel="저장"
        onSubmit={(v) => { autosave({ nickname: v.trim() || null }); setNickOpen(false); }}
        onClose={() => setNickOpen(false)}
      />

      {/* --- 시트들 --- */}
      <Sheet open={sheet === 'grade'} onClose={() => setSheet(null)} title="학년">
        {[1,2,3,4,5,6].map(g => (
          <SheetOption key={g} label={`${g}학년`} selected={profile.grade === g}
            onPress={() => { autosave({ grade: g }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'campus'} onClose={() => setSheet(null)} title="캠퍼스">
        {CAMPUS_OPTIONS.map(o => (
          <SheetOption key={o.value} label={o.label} selected={profile.campus === o.value}
            onPress={() => { autosave({ campus: o.value, college: null, dept: null }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'college'} onClose={() => setSheet(null)} title="단과대학">
        {colleges.map(c => (
          <SheetOption key={c.code} label={c.name} selected={profile.college === c.code}
            onPress={() => { autosave({ college: c.code, dept: null }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'dept'} onClose={() => setSheet(null)} title="학과">
        {depts.map(d => (
          <SheetOption key={d.code} label={d.name} selected={profile.dept === d.code}
            onPress={() => { autosave({ dept: d.code }); setSheet(null); }} />
        ))}
      </Sheet>
      {/* 복수전공: 단대 선택 → 학과 선택 2단계 */}
      <Sheet
        open={sheet === 'secondary'}
        onClose={() => { setSheet(null); setSecondaryCollegeCode(null); }}
        title={secondaryCollegeCode ? '복수전공 학과 선택' : '복수전공 단과대학 선택'}
      >
        {!secondaryCollegeCode ? (
          <>
            <SheetOption label="없음 (복수전공 해제)" selected={!profile.dept_secondary}
              onPress={() => { autosave({ dept_secondary: null }); setSheet(null); }} />
            {allColleges.map(c => (
              <SheetOption key={c.code} label={c.name} selected={false}
                onPress={() => setSecondaryCollegeCode(c.code)} />
            ))}
          </>
        ) : (
          <>
            {secondaryDepts.length > 0
              ? secondaryDepts.map(d => (
                  <SheetOption key={d.code} label={d.name} selected={profile.dept_secondary === d.code}
                    onPress={() => { autosave({ dept_secondary: d.code }); setSheet(null); setSecondaryCollegeCode(null); }} />
                ))
              : <SheetOption label="학과 정보 준비 중 — 단대만 저장" selected={false}
                  onPress={() => { autosave({ dept_secondary: secondaryCollegeCode }); setSheet(null); setSecondaryCollegeCode(null); }} />
            }
            <TouchableOpacity style={[styles.sheetDone, styles.sheetDoneRow]} onPress={() => setSecondaryCollegeCode(null)}>
              <ChevronLeftIcon size={16} color={COLORS.textSecondary} />
              <Text style={[styles.sheetDoneText, { color: COLORS.textSecondary }]}>단과대학 다시 선택</Text>
            </TouchableOpacity>
          </>
        )}
      </Sheet>
      <Sheet open={sheet === 'status'} onClose={() => setSheet(null)} title="재학상태 (복수 선택)">
        {STATUS_OPTIONS.map(o => {
          const selected = profile.enrollment_status.includes(o.value);
          return (
            <SheetOption key={o.value} label={o.label} selected={selected} onPress={() => {
              const next = selected
                ? profile.enrollment_status.filter(s => s !== o.value)
                : [...profile.enrollment_status, o.value];
              autosave({ enrollment_status: next });
            }} />
          );
        })}
        <TouchableOpacity style={styles.sheetDone} onPress={() => setSheet(null)}>
          <Text style={styles.sheetDoneText}>완료</Text>
        </TouchableOpacity>
      </Sheet>
      <Sheet open={sheet === 'dorm'} onClose={() => setSheet(null)} title="기숙사 거주">
        <SheetOption label="예" selected={profile.is_dormitory}
          onPress={() => { autosave({ is_dormitory: true }); setSheet(null); }} />
        <SheetOption label="아니요" selected={!profile.is_dormitory}
          onPress={() => { autosave({ is_dormitory: false }); setSheet(null); }} />
      </Sheet>
    </SafeAreaView>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.groupCard}>{children}</View>
    </View>
  );
}

function Row_({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.6 : 1}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
        {onPress ? <ChevronRightIcon size={16} color={COLORS.textTertiary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const SHEET_OFFSET = 500; // 시트가 아래에서 올라오는 거리

// 백드롭은 제자리에서 페이드인, 시트만 아래에서 슬라이드업 (둘이 함께 올라오지 않게).
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  // 내비바 뒤까지 내려가는 시트라 하단 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, anim]);

  if (!mounted) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_OFFSET, 0] });

  return (
    // statusBar/navigationBarTranslucent: 안드로이드에서 백드롭이 상태바·내비바 영역까지 덮도록
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: anim }]} />
        </TouchableWithoutFeedback>
        <Animated.View style={[styles.sheet, { paddingBottom: SPACING.xxl + insets.bottom, transform: [{ translateY }] }]}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SheetOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.sheetOption} onPress={onPress}>
      <Text style={[styles.sheetOptionText, selected && styles.sheetOptionActive]}>{label}</Text>
      {selected ? <CheckIcon size={18} color={COLORS.accent} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  back: { fontSize: FONT.body, color: COLORS.text },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  saveBtn: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  group: { marginBottom: SPACING.xl },
  groupLabel: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.6 },
  groupCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  rowLabel: { fontSize: FONT.body, color: COLORS.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, maxWidth: '55%' },
  rowValue: { fontSize: FONT.body, color: COLORS.textSecondary },
  rowChevron: { fontSize: 16, color: COLORS.textTertiary },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
  sheetTitle: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.8 },
  sheetOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  sheetOptionText: { fontSize: FONT.body, color: COLORS.text },
  sheetOptionActive: { color: COLORS.accent, fontWeight: WEIGHT.semibold },
  sheetDone: { marginTop: SPACING.md, alignItems: 'center', paddingVertical: SPACING.sm },
  sheetDoneRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.xs },
  sheetDoneText: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
});
