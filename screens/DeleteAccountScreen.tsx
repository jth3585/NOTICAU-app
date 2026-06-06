import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { deleteAccount, ensureAnonSession } from '../lib/auth';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function DeleteAccountScreen() {
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);

  const runDelete = async () => {
    setBusy(true);
    const ok = await deleteAccount();
    if (!ok) {
      setBusy(false);
      Alert.alert('탈퇴 실패', '잠시 후 다시 시도해주세요.');
      return;
    }
    // 새 익명 세션 발급 후 온보딩으로 초기화.
    await ensureAnonSession();
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  const confirm = () => {
    Alert.alert(
      '정말 탈퇴하시겠어요?',
      '북마크, 읽음 상태, 키워드, 프로필 등 모든 데이터가 즉시 삭제되며 복구할 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '탈퇴하기', style: 'destructive', onPress: runDelete },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} disabled={busy}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>회원 탈퇴</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>탈퇴하면 모든 데이터가 삭제됩니다</Text>
          <Text style={styles.warnItem}>· 북마크한 공지</Text>
          <Text style={styles.warnItem}>· 읽음 상태</Text>
          <Text style={styles.warnItem}>· 관심 키워드</Text>
          <Text style={styles.warnItem}>· 프로필 및 카테고리 설정</Text>
        </View>
        <Text style={styles.note}>삭제된 데이터는 복구할 수 없습니다.</Text>

        <TouchableOpacity
          style={[styles.deleteBtn, busy && styles.deleteBtnDisabled]}
          onPress={confirm}
          disabled={busy}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteBtnText}>{busy ? '탈퇴 처리 중…' : '정말 탈퇴하기'}</Text>
        </TouchableOpacity>
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
  warnBox: { backgroundColor: COLORS.dangerSoft, borderRadius: RADIUS.card, padding: SPACING.lg, marginBottom: SPACING.md },
  warnTitle: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: COLORS.danger, marginBottom: SPACING.sm },
  warnItem: { fontSize: FONT.body, color: COLORS.text, lineHeight: 24 },
  note: { fontSize: FONT.caption, color: COLORS.textSecondary, marginBottom: SPACING.xl },
  deleteBtn: { backgroundColor: COLORS.danger, borderRadius: RADIUS.card, paddingVertical: SPACING.md + 2, alignItems: 'center' },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnText: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: '#fff' },
});
