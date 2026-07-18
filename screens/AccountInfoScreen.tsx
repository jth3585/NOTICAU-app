import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { FileTextIcon, ShieldIcon, TrashIcon } from '../components/ui/icons';
import { SettingsGroup, SettingsRow } from '../components/ui/SettingsRow';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// 마이페이지에서 분리한 약관·개인정보·탈퇴 모음. 메인을 깔끔하게 유지.
export default function AccountInfoScreen() {
  const navigation = useNavigation<Nav>();
  // edges=['top']이라 하단은 콘텐츠가 내비바 뒤로 흐름 → 스크롤 끝 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>계정 정보</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: SPACING.xxl + insets.bottom }]}>
        <SettingsGroup>
          <SettingsRow icon={<FileTextIcon size={16} color={COLORS.textSecondary} />} label="이용약관" onPress={() => navigation.navigate('Terms')} />
          <SettingsRow icon={<ShieldIcon size={16} color={COLORS.textSecondary} />} label="개인정보 처리방침" onPress={() => navigation.navigate('Privacy')} />
          <SettingsRow icon={<TrashIcon size={16} color={COLORS.danger} />} label="회원 탈퇴" danger last onPress={() => navigation.navigate('DeleteAccount')} />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  title: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text },
  scroll: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
});
