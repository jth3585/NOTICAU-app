import { useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { CloseIcon } from '../components/ui/icons';
import { BackButton } from '../components/ui/BackButton';

type Keyword = { id: string; keyword: string; notify: boolean };

// 폴백/시드 추천 키워드. 실제로는 popular_keywords RPC(전체 사용자 인기)를 우선하고,
// 데이터가 부족할 때 이 목록으로 채운다. 두 줄 안에 들어가도록 최대 8개만 노출.
const RECOMMENDED = ['장학', '등록금', '수강신청', '계절학기', '교환학생', '인턴', '공모전', '졸업', '현장실습', '비교과'];
const MAX_RECO = 8;

export default function KeywordManageScreen() {
  const navigation = useNavigation();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [popular, setPopular] = useState<string[]>([]); // 전체 사용자 인기 키워드
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const loadKeywords = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('user_keywords')
      .select('id,keyword,notify').eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    setKeywords((data as Keyword[]) ?? []);
  };

  useEffect(() => { loadKeywords(); }, []);

  // 전체 사용자 인기 키워드 로드 (최소 5명 이상 등록). 상위부터 하드코딩 추천을
  // 앞에서 대체하고, 5명 미만이라 비는 자리는 큐레이션으로 채운다.
  useEffect(() => {
    supabase.rpc('popular_keywords', { p_limit: MAX_RECO, p_min: 5 }).then(({ data }) => {
      if (data) setPopular((data as { keyword: string }[]).map(r => r.keyword));
    });
  }, []);

  const addKeyword = async (text: string) => {
    if (!text || adding) return;
    if (keywords.some(k => k.keyword === text)) return;
    setAdding(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAdding(false); return; }
    const { data } = await supabase.from('user_keywords')
      .insert({ user_id: session.user.id, keyword: text, notify: false })
      .select('id,keyword,notify').single();
    if (data) setKeywords(prev => [data as Keyword, ...prev]);
    setAdding(false);
  };

  const handleAdd = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await addKeyword(text);
  };

  // 인기 키워드 우선 + 큐레이션으로 채움 → 중복/이미등록 제거 → 최대 8개(두 줄).
  const recommended = [...popular, ...RECOMMENDED]
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(r => !keywords.some(k => k.keyword === r))
    .slice(0, MAX_RECO);

  const handleDelete = async (id: string) => {
    await supabase.from('user_keywords').delete().eq('id', id);
    setKeywords(prev => prev.filter(k => k.id !== id));
  };

  const handleToggleNotify = async (id: string, next: boolean) => {
    setKeywords(prev => prev.map(k => k.id === id ? { ...k, notify: next } : k));
    await supabase.from('user_keywords').update({ notify: next }).eq('id', id);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>키워드 관리</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* 입력 바 */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="키워드 입력 (최대 30자)"
            placeholderTextColor={COLORS.textTertiary}
            value={input}
            onChangeText={t => setInput(t.slice(0, 30))}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity style={[styles.addBtn, !input.trim() && styles.addBtnDisabled]} onPress={handleAdd}>
            <Text style={styles.addBtnText}>추가</Text>
          </TouchableOpacity>
        </View>

        {recommended.length > 0 ? (
          <View style={styles.recoSection}>
            <Text style={styles.recoLabel}>추천 키워드</Text>
            <View style={styles.recoChips}>
              {recommended.map(r => (
                <TouchableOpacity key={r} style={styles.recoChip} onPress={() => addKeyword(r)} disabled={adding} activeOpacity={0.7}>
                  <Text style={styles.recoChipText}>+ {r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {keywords.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>관심 키워드를 추가해 보세요.</Text>
            <Text style={styles.emptyHint}>키워드가 포함된 공지를 빠르게 찾을 수 있어요.</Text>
          </View>
        ) : (
          <FlatList
            data={keywords}
            keyExtractor={k => k.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.keywordRow}>
                <Text style={styles.keywordText}>{item.keyword}</Text>
                <View style={styles.keywordActions}>
                  <Text style={styles.notifyLabel}>알림</Text>
                  <Switch
                    value={item.notify}
                    onValueChange={next => handleToggleNotify(item.id, next)}
                    trackColor={{ true: COLORS.accent }}
                    thumbColor="#fff"
                    style={{ transform: [{ scale: 0.75 }] }}
                  />
                  <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={8}>
                    <CloseIcon size={16} color={COLORS.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  back: { fontSize: FONT.body, color: COLORS.text },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.sm },
  input: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.box, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: FONT.body, color: COLORS.text },
  addBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.box, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  addBtnDisabled: { backgroundColor: COLORS.surface2 },
  addBtnText: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: '#fff' },
  recoSection: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  recoLabel: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold, marginBottom: SPACING.sm },
  recoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  recoChip: { backgroundColor: COLORS.surface, borderRadius: RADIUS.box, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  recoChipText: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  keywordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  keywordText: { fontSize: FONT.body, color: COLORS.text, flex: 1 },
  keywordActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  notifyLabel: { fontSize: FONT.caption, color: COLORS.textSecondary },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, padding: SPACING.xl },
  emptyText: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  emptyHint: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center' },
});
