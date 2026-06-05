import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { ProgressBar } from './ProgressBar';

type Props = {
  step: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextEnabled?: boolean;
  children: ReactNode;
};

export function OnboardingLayout({
  step, title, subtitle, onBack, onNext,
  nextLabel = '다음', nextEnabled = false, children,
}: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* 헤더 */}
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backBtn}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
        ) : <View style={styles.backBtn} />}
        <View style={styles.progress}>
          <ProgressBar step={step} />
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* 본문 */}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.options}>{children}</View>
      </ScrollView>

      {/* 하단 버튼 */}
      {onNext ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.nextBtn, !nextEnabled && styles.nextBtnDisabled]}
            onPress={nextEnabled ? onNext : undefined}
            activeOpacity={nextEnabled ? 0.75 : 1}
          >
            <Text style={[styles.nextText, !nextEnabled && styles.nextTextDisabled]}>
              {nextLabel}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
  },
  backBtn: { width: 32 },
  backText: { fontSize: 24, color: COLORS.text, lineHeight: 28 },
  progress: { flex: 1 },
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  title: {
    fontSize: FONT.display,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: FONT.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  options: { gap: SPACING.sm },
  footer: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  nextBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md + 2,
    alignItems: 'center',
  },
  nextBtnDisabled: { backgroundColor: COLORS.surface2 },
  nextText: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: '#fff' },
  nextTextDisabled: { color: COLORS.textTertiary },
});
