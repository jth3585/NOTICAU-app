import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { ProgressBar } from './ProgressBar';

const TOTAL_STEPS = 7;

type Props = {
  step: number;
  title: string;
  subtitle?: string;
  icon?: ReactNode; // 단계별 시각 앵커 (틴트 원 안에 표시)
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextEnabled?: boolean;
  children: ReactNode;
};

export function OnboardingLayout({
  step, title, subtitle, icon, onBack, onNext,
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
        <Text style={styles.stepText}>{step} / {TOTAL_STEPS}</Text>
      </View>

      {/* 본문 */}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {icon ? <View style={styles.iconCircle}>{icon}</View> : null}
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
  stepText: { width: 38, textAlign: 'right', fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary, fontVariant: ['tabular-nums'] },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
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
