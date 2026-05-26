import { Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

// file_down.php?uploadFileOrgName=... 형태면 원본 파일명 추출, 아니면 URL 꼬리
function fileNameOf(url: string, label?: string): string {
  if (label) return label;
  try {
    const u = new URL(url);
    const org = u.searchParams.get('uploadFileOrgName');
    if (org) return org;
  } catch {
    // URL 파싱 실패 → 폴백
  }
  const tail = (url.split('/').pop() || '').split('?')[0];
  try {
    return decodeURIComponent(tail) || '첨부파일';
  } catch {
    return tail || '첨부파일';
  }
}

function extOf(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]{1,5})$/);
  return m ? m[1].toUpperCase() : '';
}

export function AttachmentRow({ url, label }: { url: string; label?: string }) {
  const name = fileNameOf(url, label);
  const ext = extOf(name);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.6}
    >
      <Text style={styles.icon}>📎</Text>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {ext ? <Text style={styles.ext}>{ext}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  icon: { fontSize: FONT.body },
  name: { flex: 1, fontSize: FONT.body, color: COLORS.text },
  ext: {
    fontSize: FONT.micro,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surface2,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.badge,
  },
});
