import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../../lib/theme';
import { ChevronRightIcon } from './icons';

// 설정 그룹 카드 (흰 양각 컨테이너)
export function SettingsGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

// 설정 행: 틴트 아이콘 + 라벨(+부제) + 우측요소(chevron 또는 스위치 등). danger 변형.
export function SettingsRow({
  icon, label, subtitle, onPress, danger, last, rightElement,
}: {
  icon?: ReactNode;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
  rightElement?: ReactNode; // 지정 시 chevron 대신 표시(예: Switch)
}) {
  const inner = (
    <>
      <View style={styles.left}>
        {icon ? <View style={[styles.iconBox, danger && styles.iconBoxDanger]}>{icon}</View> : null}
        <View style={styles.labelWrap}>
          <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {rightElement ?? <ChevronRightIcon size={18} color={COLORS.textTertiary} />}
    </>
  );
  if (!onPress) {
    return <View style={[styles.row, last && styles.rowLast]}>{inner}</View>;
  }
  return (
    <TouchableOpacity style={[styles.row, last && styles.rowLast]} onPress={onPress} activeOpacity={0.6}>
      {inner}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  rowLast: { borderBottomWidth: 0 },
  left: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  labelWrap: { flex: 1, gap: 2 },
  subtitle: { fontSize: FONT.caption, color: COLORS.textTertiary },
  iconBox: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: COLORS.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBoxDanger: { backgroundColor: COLORS.dangerSoft },
  label: { fontSize: FONT.body, color: COLORS.text },
  labelDanger: { color: COLORS.danger },
});
