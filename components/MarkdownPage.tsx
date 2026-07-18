import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMarkdown } from 'react-native-marked';
import type { MarkedStyles } from 'react-native-marked';
import { COLORS, FONT, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from './ui/BackButton';

// 약관/개인정보 등 정적 마크다운 문서를 헤더 + 스크롤로 표시하는 공용 화면.
export function MarkdownPage({ title, markdown }: { title: string; markdown: string }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const elements = useMarkdown(markdown, { styles: mdStyles });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: SPACING.xxl + insets.bottom }]}>{elements}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  back: { fontSize: FONT.body, color: COLORS.text },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  scroll: { paddingHorizontal: SPACING.lg },
});

const mdStyles: MarkedStyles = {
  text: { fontSize: FONT.body, lineHeight: 22, color: COLORS.text },
  h1: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text, marginTop: SPACING.md, marginBottom: SPACING.sm },
  h2: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  paragraph: { marginVertical: SPACING.xs },
  strong: { fontWeight: WEIGHT.semibold, color: COLORS.text },
  li: { fontSize: FONT.body, lineHeight: 22, color: COLORS.text },
};
