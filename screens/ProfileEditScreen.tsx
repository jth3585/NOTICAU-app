import { useCallback, useEffect, useState } from 'react';
import {
  Modal, ScrollView, StyleSheet, Text, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

type Profile = {
  grade: number;
  campus: string;
  college: string | null;
  dept: string | null;
  dept_secondary: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
};
type Row = { code: string; name: string };

const CAMPUS_OPTIONS = [{ value: 'seoul', label: '서울' }, { value: 'davinci', label: '다빈치' }];
const STATUS_OPTIONS = [
  { value: 'enrolled', label: '재학중' }, { value: 'on_leave', label: '휴학중' },
  { value: 'returning', label: '복학예정' }, { value: 'graduating', label: '졸업예정' },
];
const CAMPUS_LABEL: Record<string, string> = { seoul: '서울', davinci: '다빈치' };
const STATUS_LABEL: Record<string, string> = {
  enrolled: '재학중', on_leave: '휴학중', returning: '복학예정', graduating: '졸업예정',
};

export default function ProfileEditScreen() {
  const navigation = useNavigation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [colleges, setColleges] = useState<Row[]>([]);
  const [depts, setDepts] = useState<Row[]>([]);
  const [allDepts, setAllDepts] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null); // which field sheet is open

  // Load profile
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle();
      if (data) setProfile(data as Profile);
    })();
    supabase.from('departments').select('code,name').order('name').then(({ data }) => setAllDepts((data as Row[]) ?? []));
  }, []);

  // Load colleges when campus changes
  useEffect(() => {
    if (!profile?.campus) return;
    const campusDb = profile.campus === 'davinci' ? 'anseong' : profile.campus;
    supabase.from('colleges').select('code,name').eq('campus', campusDb).order('name')
      .then(({ data }) => setColleges((data as Row[]) ?? []));
  }, [profile?.campus]);

  // Load depts when college changes
  useEffect(() => {
    if (!profile?.college) { setDepts([]); return; }
    supabase.from('departments').select('code,name').eq('college_code', profile.college).order('name')
      .then(({ data }) => setDepts((data as Row[]) ?? []));
  }, [profile?.college]);

  const patch = useCallback((p: Partial<Profile>) => setProfile((prev) => prev ? { ...prev, ...p } : prev), []);

  const handleSave = async () => {
    if (!profile || saving) return;
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    await supabase.from('profiles').update({
      grade: profile.grade, campus: profile.campus, college: profile.college,
      dept: profile.dept, dept_secondary: profile.dept_secondary,
      enrollment_status: profile.enrollment_status, is_dormitory: profile.is_dormitory,
    }).eq('user_id', session.user.id);
    setSaving(false);
    navigation.goBack();
  };

  const nameOf = (list: Row[], code: string | null | undefined) =>
    list.find(r => r.code === code)?.name ?? code ?? '—';

  const statusText = (profile?.enrollment_status ?? []).map(s => STATUS_LABEL[s]).join(', ') || '—';

  if (!profile) return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={{ color: COLORS.textSecondary, padding: SPACING.lg }}>로딩 중…</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>프로필 수정</Text>
        <TouchableOpacity onPress={handleSave} hitSlop={8}>
          <Text style={[styles.saveBtn, saving && { opacity: 0.5 }]}>{saving ? '저장 중…' : '저장'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Group label="기본 정보">
          <Row_ label="학년" value={`${profile.grade}학년`} onPress={() => setSheet('grade')} />
          <Row_ label="캠퍼스" value={CAMPUS_LABEL[profile.campus] ?? profile.campus} onPress={() => setSheet('campus')} />
        </Group>
        <Group label="소속">
          <Row_ label="단과대학" value={nameOf(colleges, profile.college)} onPress={() => setSheet('college')} />
          <Row_ label="학과" value={nameOf(depts, profile.dept) || (depts.length === 0 && profile.college ? '준비 중' : '—')} onPress={() => depts.length > 0 && setSheet('dept')} />
          <Row_ label="복수전공" value={nameOf(allDepts, profile.dept_secondary) || '없음'} onPress={() => setSheet('secondary')} />
        </Group>
        <Group label="상태">
          <Row_ label="재학상태" value={statusText} onPress={() => setSheet('status')} />
          <Row_ label="기숙사" value={profile.is_dormitory ? '예' : '아니요'} onPress={() => setSheet('dorm')} />
        </Group>
      </ScrollView>

      {/* --- 시트들 --- */}
      <Sheet open={sheet === 'grade'} onClose={() => setSheet(null)} title="학년">
        {[1,2,3,4,5,6].map(g => (
          <SheetOption key={g} label={`${g}학년`} selected={profile.grade === g}
            onPress={() => { patch({ grade: g }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'campus'} onClose={() => setSheet(null)} title="캠퍼스">
        {CAMPUS_OPTIONS.map(o => (
          <SheetOption key={o.value} label={o.label} selected={profile.campus === o.value}
            onPress={() => { patch({ campus: o.value, college: null, dept: null }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'college'} onClose={() => setSheet(null)} title="단과대학">
        {colleges.map(c => (
          <SheetOption key={c.code} label={c.name} selected={profile.college === c.code}
            onPress={() => { patch({ college: c.code, dept: null }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'dept'} onClose={() => setSheet(null)} title="학과">
        {depts.map(d => (
          <SheetOption key={d.code} label={d.name} selected={profile.dept === d.code}
            onPress={() => { patch({ dept: d.code }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'secondary'} onClose={() => setSheet(null)} title="복수전공">
        <SheetOption label="없음" selected={!profile.dept_secondary}
          onPress={() => { patch({ dept_secondary: null }); setSheet(null); }} />
        {allDepts.map(d => (
          <SheetOption key={d.code} label={d.name} selected={profile.dept_secondary === d.code}
            onPress={() => { patch({ dept_secondary: d.code }); setSheet(null); }} />
        ))}
      </Sheet>
      <Sheet open={sheet === 'status'} onClose={() => setSheet(null)} title="재학상태 (복수 선택)">
        {STATUS_OPTIONS.map(o => {
          const selected = profile.enrollment_status.includes(o.value);
          return (
            <SheetOption key={o.value} label={o.label} selected={selected} onPress={() => {
              const next = selected
                ? profile.enrollment_status.filter(s => s !== o.value)
                : [...profile.enrollment_status, o.value];
              patch({ enrollment_status: next });
            }} />
          );
        })}
        <TouchableOpacity style={styles.sheetDone} onPress={() => setSheet(null)}>
          <Text style={styles.sheetDoneText}>완료</Text>
        </TouchableOpacity>
      </Sheet>
      <Sheet open={sheet === 'dorm'} onClose={() => setSheet(null)} title="기숙사 거주">
        <SheetOption label="예" selected={profile.is_dormitory}
          onPress={() => { patch({ is_dormitory: true }); setSheet(null); }} />
        <SheetOption label="아니요" selected={!profile.is_dormitory}
          onPress={() => { patch({ is_dormitory: false }); setSheet(null); }} />
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
        {onPress ? <Text style={styles.rowChevron}>›</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <ScrollView style={{ maxHeight: 320 }}>{children}</ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

function SheetOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.sheetOption} onPress={onPress}>
      <Text style={[styles.sheetOptionText, selected && styles.sheetOptionActive]}>{label}</Text>
      {selected ? <Text style={styles.sheetOptionActive}>✓</Text> : null}
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  sheetTitle: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.8 },
  sheetOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  sheetOptionText: { fontSize: FONT.body, color: COLORS.text },
  sheetOptionActive: { color: COLORS.accent, fontWeight: WEIGHT.semibold },
  sheetDone: { marginTop: SPACING.md, alignItems: 'center', paddingVertical: SPACING.sm },
  sheetDoneText: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
});
