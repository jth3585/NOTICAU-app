import { useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

type Keyword = { id: string; keyword: string; notify: boolean };

export default function KeywordManageScreen() {
  const navigation = useNavigation();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
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

  const handleAdd = async () => {
    const text = input.trim();
    if (!text || adding) return;
    if (keywords.some(k => k.keyword === text)) { setInput(''); return; }
    setAdding(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAdding(false); return; }
    const { data } = await supabase.from('user_keywords')
      .insert({ user_id: session.user.id, keyword: text, notify: false })
      .select('id,keyword,notify').single();
    if (data) setKeywords(prev => [data as Keyword, ...prev]);
    setInput('');
    setAdding(false);
  };

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
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
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
                  />
                  <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={8}>
                    <Text style={styles.deleteBtn}>✕</Text>
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
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  keywordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  keywordText: { fontSize: FONT.body, color: COLORS.text, flex: 1 },
  keywordActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  notifyLabel: { fontSize: FONT.caption, color: COLORS.textSecondary },
  deleteBtn: { fontSize: FONT.caption, color: COLORS.textTertiary, paddingHorizontal: SPACING.xs },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, padding: SPACING.xl },
  emptyText: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  emptyHint: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center' },
});
